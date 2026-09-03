from __future__ import annotations

import base64
import ctypes
import json
import os
import re
import tempfile
import uuid
from ctypes import wintypes
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from urllib.parse import urlparse

# The retired PHP agent (agentAutoData) shipped under the same name and
# stored an incompatible config.json and its own agent.log in
# %LOCALAPPDATA%\\TMTDrugMasterAgent. Sharing that directory meant this
# agent silently discarded a foreign config, overwrote it on the next save,
# and appended to a log already full of the other program's errors.
APP_DIRECTORY = "TMTDrugMasterPlatformAgent"
DEFAULT_SERVER_URL = "https://drug-master-platform.vercel.app"
OFFICE_PATTERN = re.compile(r"^\d{5}$")


def is_valid_office_id(value: str) -> bool:
    return bool(OFFICE_PATTERN.fullmatch(value)) and not value.startswith("0000")


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _crypt_protect(text: str) -> str:
    """Windows DPAPI, current user scope. Secrets never leave this machine."""
    raw = text.encode("utf-8")
    buffer = ctypes.create_string_buffer(raw)
    source = DataBlob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    destination = DataBlob()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), "TMT Drug Master Agent", None, None, None, 0, ctypes.byref(destination)
    ):
        raise ctypes.WinError()
    try:
        return base64.b64encode(ctypes.string_at(destination.pbData, destination.cbData)).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(destination.pbData)


def _crypt_unprotect(value: str) -> str:
    if not value:
        return ""
    raw = base64.b64decode(value, validate=True)
    buffer = ctypes.create_string_buffer(raw)
    source = DataBlob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    destination = DataBlob()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(destination)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(destination.pbData, destination.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(destination.pbData)


def app_data_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise RuntimeError("ไม่พบ LOCALAPPDATA ของ Windows")
    path = Path(local) / APP_DIRECTORY
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass(frozen=True)
class AgentConfig:
    """
    installation_id is stable for the life of this installation and survives
    re-enrollment into another facility (docs/AGENT_PROTOCOL.md).
    """

    installation_id: str
    # Prefilled so a รพ.สต. only has to type its JHCIS details. Overridable for
    # a self-hosted deployment.
    server_url: str = DEFAULT_SERVER_URL
    key_id: str = ""
    secret: str = ""
    facility_code: str = ""
    machine_label: str = ""
    jhcis_host: str = "127.0.0.1"
    jhcis_port: int = 3333
    jhcis_database: str = "jhcisdb"
    jhcis_user: str = "root"
    jhcis_password: str = ""
    auto_sync_enabled: bool = True
    auto_sync_interval_minutes: int = 720
    poll_interval_seconds: int = 20

    @classmethod
    def blank(cls) -> "AgentConfig":
        return cls(installation_id=str(uuid.uuid4()))

    @property
    def enrolled(self) -> bool:
        return bool(self.key_id and self.secret and self.server_url and self.facility_code)

    def validate_server_url(self) -> None:
        parsed = urlparse(self.server_url)
        hostname = (parsed.hostname or "").lower()
        local = hostname in {"localhost", "127.0.0.1"} or hostname.endswith(".test")
        if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
            raise ValueError("Server URL ต้องใช้ HTTPS ยกเว้น localhost, 127.0.0.1 หรือ .test")
        if parsed.query or parsed.fragment or not hostname:
            raise ValueError("Server URL ไม่ถูกต้อง")

    def validate_jhcis(self) -> None:
        if not self.jhcis_host.strip() or not (1 <= self.jhcis_port <= 65535):
            raise ValueError("JHCIS host/port ไม่ถูกต้อง")
        if not self.jhcis_database.strip() or not self.jhcis_user.strip():
            raise ValueError("กรอก Database และ User ของ JHCIS")
        if not self.jhcis_password:
            raise ValueError("กรอกรหัสผ่านฐานข้อมูล JHCIS")

    def validate(self) -> None:
        uuid.UUID(self.installation_id)
        if self.server_url:
            self.validate_server_url()
        if self.facility_code and not is_valid_office_id(self.facility_code):
            raise ValueError("รหัสสถานบริการต้องเป็นเลข 5 หลักและไม่ใช่ 0000x")
        if not (5 <= self.poll_interval_seconds <= 300):
            raise ValueError("ช่วง poll ต้องอยู่ระหว่าง 5–300 วินาที")
        if not (15 <= self.auto_sync_interval_minutes <= 10080):
            raise ValueError("ช่วง auto sync ต้องอยู่ระหว่าง 15 นาที – 7 วัน")

    def with_credential(self, server_url: str, key_id: str, secret: str, facility_code: str) -> "AgentConfig":
        return replace(self, server_url=server_url.rstrip("/"), key_id=key_id, secret=secret, facility_code=facility_code)


class ConfigStore:
    """Atomic read/write of config.json with DPAPI-protected secret fields."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or app_data_dir() / "config.json"

    def load(self) -> AgentConfig:
        if not self.path.exists():
            return AgentConfig.blank()
        data = json.loads(self.path.read_text(encoding="utf-8"))
        data["secret"] = _crypt_unprotect(str(data.pop("secret_dpapi", "")))
        data["jhcis_password"] = _crypt_unprotect(str(data.pop("jhcis_password_dpapi", "")))
        known = {field for field in AgentConfig.__dataclass_fields__}
        return AgentConfig(**{key: value for key, value in data.items() if key in known})

    def save(self, config: AgentConfig) -> None:
        config.validate()
        data = asdict(config)
        data["secret_dpapi"] = _crypt_protect(str(data.pop("secret")))
        data["jhcis_password_dpapi"] = _crypt_protect(str(data.pop("jhcis_password")))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix="config-", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_name, self.path)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)

    def mtime(self) -> float:
        try:
            return self.path.stat().st_mtime
        except OSError:
            return 0.0
