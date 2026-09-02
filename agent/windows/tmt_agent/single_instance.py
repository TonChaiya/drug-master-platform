from __future__ import annotations

import ctypes
import json
import threading
from collections.abc import Callable
from pathlib import Path

MUTEX_NAME = "Local\\TMTDrugMasterAgentSingleInstance"
PIPE_NAME = r"\\.\pipe\TMTDrugMasterAgentIpc"
ERROR_ALREADY_EXISTS = 183
PIPE_ACCESS_DUPLEX = 0x00000003
PIPE_TYPE_MESSAGE = 0x00000004
PIPE_READMODE_MESSAGE = 0x00000002
PIPE_WAIT = 0x00000000
GENERIC_WRITE = 0x40000000
OPEN_EXISTING = 3
INVALID_HANDLE = ctypes.c_void_p(-1).value


class SingleInstance:
    def __init__(self) -> None:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel.CreateMutexW.restype = ctypes.c_void_p
        ctypes.set_last_error(0)
        self.kernel = kernel
        self.handle = kernel.CreateMutexW(None, False, MUTEX_NAME)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.already_running = ctypes.get_last_error() == ERROR_ALREADY_EXISTS

    def close(self) -> None:
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def send_to_running_instance(message: dict[str, object], timeout_ms: int = 3000) -> bool:
    """
    Hands the enrollment link to the tray process that already owns the config.
    This is what stops a second process from writing config the first one never
    re-reads — the reconnect defect listed in AGENTS.md.
    """
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.restype = ctypes.c_void_p
    if not kernel.WaitNamedPipeW(PIPE_NAME, timeout_ms):
        return False
    handle = kernel.CreateFileW(PIPE_NAME, GENERIC_WRITE, 0, None, OPEN_EXISTING, 0, None)
    if handle in (None, INVALID_HANDLE):
        return False
    try:
        payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
        written = ctypes.c_ulong(0)
        return bool(kernel.WriteFile(ctypes.c_void_p(handle), payload, len(payload), ctypes.byref(written), None))
    finally:
        kernel.CloseHandle(ctypes.c_void_p(handle))


class IpcServer:
    """Named-pipe listener owned by the single running tray instance."""

    def __init__(self, on_message: Callable[[dict[str, object]], None]) -> None:
        self.on_message = on_message
        self.stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._serve, name="tmt-agent-ipc", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.stop_event.set()

    def _serve(self) -> None:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateNamedPipeW.restype = ctypes.c_void_p
        while not self.stop_event.is_set():
            handle = kernel.CreateNamedPipeW(
                PIPE_NAME,
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
                1,
                8192,
                8192,
                0,
                None,
            )
            if handle in (None, INVALID_HANDLE):
                self.stop_event.wait(1.0)
                continue
            try:
                if not kernel.ConnectNamedPipe(ctypes.c_void_p(handle), None):
                    continue
                buffer = ctypes.create_string_buffer(8192)
                read = ctypes.c_ulong(0)
                if not kernel.ReadFile(ctypes.c_void_p(handle), buffer, 8192, ctypes.byref(read), None):
                    continue
                try:
                    message = json.loads(buffer.raw[: read.value].decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    continue
                if isinstance(message, dict):
                    self.on_message(message)
            finally:
                kernel.DisconnectNamedPipe(ctypes.c_void_p(handle))
                kernel.CloseHandle(ctypes.c_void_p(handle))
