from __future__ import annotations

import ctypes
import logging
import os
import socket
import sys
import threading
from collections.abc import Callable
from dataclasses import replace
from logging.handlers import RotatingFileHandler
from pathlib import Path
from tkinter import messagebox, ttk
import tkinter as tk

import pystray
from PIL import Image, ImageDraw

from poc_agent.config import AgentConfig, ConfigStore, app_data_dir
from poc_agent.jhcis import JhcisConnectionError, JhcisResult, test_jhcis
from poc_agent.web import WebConnectionError, report_jhcis, test_web
from version import VERSION

APP_NAME = "TMT Drug Master Agent PoC"
MUTEX_NAME = "Local\\TMTDrugMasterAgentPocSingleInstance"


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("poc-agent")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = RotatingFileHandler(app_data_dir() / "agent.log", maxBytes=1_000_000, backupCount=2, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    return logger


def create_icon(color: str) -> Image.Image:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((6, 6, 58, 58), radius=14, fill=color)
    draw.rectangle((19, 29, 45, 35), fill="white")
    draw.rectangle((29, 19, 35, 45), fill="white")
    return image


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
        self.already_running = ctypes.get_last_error() == 183

    def close(self) -> None:
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class AgentApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.withdraw()
        self.store = ConfigStore()
        self.config = self._load_config()
        self.last_jhcis: JhcisResult | None = None
        self.status_text = "ยังไม่ได้ทดสอบ"
        self.logger = setup_logger()
        self.settings_window: tk.Toplevel | None = None
        self.entries: dict[str, tk.Entry] = {}
        self.settings_status: ttk.Label | None = None
        self.icon = pystray.Icon(
            "TMTDrugMasterAgentPoc",
            create_icon("#64748b"),
            f"{APP_NAME} - {self.status_text}",
            menu=pystray.Menu(
                pystray.MenuItem(lambda _item: f"สถานะล่าสุด: {self.status_text}", None, enabled=False),
                pystray.MenuItem("เปิดหน้าตั้งค่า", lambda _icon, _item: self.root.after(0, self.open_settings)),
                pystray.MenuItem("ทดสอบใหม่", lambda _icon, _item: self.root.after(0, self.retest)),
                pystray.MenuItem("เปิด log แบบ sanitized", lambda _icon, _item: self.open_log()),
                pystray.MenuItem("ออกจากโปรแกรม", lambda _icon, _item: self.root.after(0, self.quit)),
            ),
        )

    def _load_config(self) -> AgentConfig:
        try:
            return self.store.load()
        except (OSError, ValueError, KeyError, TypeError):
            messagebox.showwarning(APP_NAME, "อ่าน config เดิมไม่สำเร็จ กรุณาตั้งค่าใหม่")
            return AgentConfig.blank()

    def set_status(self, text: str, state: str = "idle") -> None:
        self.status_text = text[:120]
        color = {"ok": "#087c5b", "error": "#b42318", "busy": "#c58a00"}.get(state, "#64748b")
        self.icon.icon = create_icon(color)
        self.icon.title = f"{APP_NAME} - {self.status_text}"
        if self.settings_status is not None:
            self.settings_status.configure(text=text, foreground=color)

    def _field(self, parent: ttk.Frame, row: int, key: str, label: str, value: str, secret: bool = False) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 10), pady=4)
        entry = ttk.Entry(parent, show="•" if secret else "")
        entry.grid(row=row, column=1, sticky="ew", pady=4)
        entry.insert(0, value)
        self.entries[key] = entry

    def open_settings(self) -> None:
        if self.settings_window is not None and self.settings_window.winfo_exists():
            self.settings_window.deiconify()
            self.settings_window.lift()
            self.settings_window.focus_force()
            return
        window = tk.Toplevel(self.root)
        self.settings_window = window
        window.title(f"{APP_NAME} v{VERSION}")
        window.geometry("650x570")
        window.minsize(580, 530)
        window.protocol("WM_DELETE_WINDOW", window.withdraw)
        frame = ttk.Frame(window, padding=18)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(1, weight=1)
        ttk.Label(frame, text="ตั้งค่าการเชื่อมต่อ PoC", font=("Segoe UI", 16, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(frame, text="Agent ส่งเฉพาะผลตรวจ officeId และจำนวนยา 01/10", foreground="#64748b").grid(row=1, column=0, columnspan=2, sticky="w", pady=(2, 12))
        self.entries = {}
        self._field(frame, 2, "server_url", "Server URL", self.config.server_url)
        self._field(frame, 3, "agent_key", "Agent Key", self.config.agent_key)
        self._field(frame, 4, "agent_secret", "Agent Secret", self.config.agent_secret, True)
        self._field(frame, 5, "jhcis_host", "JHCIS Host", self.config.jhcis_host)
        self._field(frame, 6, "jhcis_port", "Port", str(self.config.jhcis_port))
        self._field(frame, 7, "jhcis_database", "Database", self.config.jhcis_database)
        self._field(frame, 8, "jhcis_user", "User", self.config.jhcis_user)
        self._field(frame, 9, "jhcis_password", "Database password", self.config.jhcis_password, True)
        self._field(frame, 10, "allowed_office_id", "Office ID ที่อนุญาต", self.config.allowed_office_id)
        ttk.Label(frame, text=f"Installation ID: {self.config.installation_id}", foreground="#64748b").grid(row=11, column=0, columnspan=2, sticky="w", pady=(8, 3))
        self.settings_status = ttk.Label(frame, text=self.status_text, foreground="#64748b", wraplength=580)
        self.settings_status.grid(row=12, column=0, columnspan=2, sticky="w", pady=(4, 10))
        buttons = ttk.Frame(frame)
        buttons.grid(row=13, column=0, columnspan=2, sticky="ew")
        ttk.Button(buttons, text="ทดสอบ JHCIS", command=self.test_jhcis_action).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="ทดสอบ Web API", command=self.test_web_action).pack(side="left", padx=6)
        ttk.Button(buttons, text="ส่งผลทดสอบขึ้นเว็บ", command=self.send_report_action).pack(side="left", padx=6)
        ttk.Button(buttons, text="บันทึกและย่อไป Tray", command=self.save_and_hide).pack(side="right", padx=(6, 0))

    def config_from_form(self) -> AgentConfig:
        if not self.entries:
            return self.config
        try:
            port = int(self.entries["jhcis_port"].get().strip())
        except ValueError:
            raise ValueError("Port ต้องเป็นตัวเลข") from None
        config = replace(
            self.config,
            server_url=self.entries["server_url"].get().strip().rstrip("/"),
            agent_key=self.entries["agent_key"].get().strip(),
            agent_secret=self.entries["agent_secret"].get(),
            jhcis_host=self.entries["jhcis_host"].get().strip(),
            jhcis_port=port,
            jhcis_database=self.entries["jhcis_database"].get().strip(),
            jhcis_user=self.entries["jhcis_user"].get().strip(),
            jhcis_password=self.entries["jhcis_password"].get(),
            allowed_office_id=self.entries["allowed_office_id"].get().strip(),
        )
        return config

    def run_worker(self, label: str, work: Callable[[], object]) -> None:
        self.set_status(label, "busy")

        def runner() -> None:
            try:
                result = work()
                self.root.after(0, lambda: self.worker_success(result))
            except (ValueError, JhcisConnectionError, WebConnectionError) as error:
                code = getattr(error, "code", "CONFIG_INVALID")
                self.logger.warning("operation_failed code=%s", code)
                self.root.after(0, lambda: self.set_status(str(error), "error"))
            except Exception:
                self.logger.error("operation_failed code=UNEXPECTED")
                self.root.after(0, lambda: self.set_status("เกิดข้อผิดพลาดที่ไม่คาดคิด โปรดเปิด log", "error"))

        threading.Thread(target=runner, daemon=True).start()

    def worker_success(self, result: object) -> None:
        if isinstance(result, JhcisResult):
            self.last_jhcis = result
            message = f"JHCIS สำเร็จ: office {result.office_id}, ยา 01/10 {result.eligible_drug_count:,} รายการ"
        elif hasattr(result, "request_id"):
            message = f"ส่งสำเร็จ Request ID: {result.request_id}"
        elif hasattr(result, "version"):
            message = f"Web API สำเร็จ: version {result.version}"
        else:
            message = "ทดสอบสำเร็จ"
        self.logger.info("operation_success type=%s", type(result).__name__)
        self.set_status(message, "ok")

    def test_jhcis_action(self) -> None:
        self.run_worker("กำลังทดสอบ JHCIS…", lambda: test_jhcis(self.config_from_form()))

    def test_web_action(self) -> None:
        self.run_worker("กำลังทดสอบ Web API…", lambda: test_web(self.config_from_form()))

    def send_report_action(self) -> None:
        def work() -> object:
            config = self.config_from_form()
            result = test_jhcis(config)
            self.last_jhcis = result
            return report_jhcis(config, result, socket.gethostname())

        self.run_worker("กำลังตรวจ JHCIS และส่งผล…", work)

    def retest(self) -> None:
        def work() -> object:
            result = test_jhcis(self.config)
            test_web(self.config)
            return report_jhcis(self.config, result, socket.gethostname())

        self.run_worker("กำลังทดสอบใหม่…", work)

    def save_and_hide(self) -> None:
        try:
            config = self.config_from_form()
            self.store.save(config)
            self.config = config
            self.logger.info("config_saved")
            self.set_status("บันทึกการตั้งค่าแล้ว", "ok")
            if self.settings_window is not None:
                self.settings_window.withdraw()
        except (OSError, ValueError) as error:
            self.logger.warning("config_save_failed")
            self.set_status(str(error), "error")

    def open_log(self) -> None:
        os.startfile(app_data_dir() / "agent.log")

    def quit(self) -> None:
        self.icon.stop()
        self.root.quit()
        self.root.destroy()

    def run(self) -> None:
        self.icon.run_detached()
        self.root.after(250, self.open_settings)
        self.root.mainloop()


def main() -> int:
    if "--version" in sys.argv:
        print(VERSION)
        return 0
    instance = SingleInstance()
    if instance.already_running:
        if "--startup" not in sys.argv:
            root = tk.Tk()
            root.withdraw()
            messagebox.showinfo(APP_NAME, "Agent PoC ทำงานอยู่แล้วใน System Tray")
            root.destroy()
        instance.close()
        return 0
    try:
        root = tk.Tk()
        AgentApp(root).run()
        return 0
    finally:
        instance.close()


if __name__ == "__main__":
    raise SystemExit(main())
