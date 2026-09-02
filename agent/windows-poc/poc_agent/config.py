from __future__ import annotations

import base64
import ctypes
import json
import os
import re
import tempfile
import uuid
from ctypes import wintypes
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

APP_DIRECTORY = "TMTDrugMasterAgentPoc"
OFFICE_PATTERN = re.compile(r"^\d{5}$")


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _crypt_protect(text: str) -> str:
    raw = text.encode("utf-8")
    buffer = ctypes.create_string_buffer(raw)
    source = DataBlob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    destination = DataBlob()
    description = "TMT Drug Master Agent PoC"
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), description, None, None, None, 0, ctypes.byref(destination)
    ):
        raise ctypes.WinError()
    try:
        return base64.b64encode(ctypes.string_at(destination.pbData, destination.cbData)).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(destination.pbData)


def _crypt_unprotect(value: str) -> str:
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
    installation_id: str
    server_url: str
    agent_key: str
    agent_secret: str
    jhcis_host: str = "127.0.0.1"
    jhcis_port: int = 3333
    jhcis_database: str = "jhcisdb"
    jhcis_user: str = "root"
    jhcis_password: str = ""
    allowed_office_id: str = ""

    @classmethod
    def blank(cls) -> "AgentConfig":
        return cls(str(uuid.uuid4()), "", "", "")

    def validate(self) -> None:
        uuid.UUID(self.installation_id)
        self.validate_server_url()
        self.validate_agent_credentials()
        self.validate_jhcis()

    def validate_server_url(self) -> None:
        parsed = urlparse(self.server_url)
        hostname = (parsed.hostname or "").lower()
        local = hostname in {"localhost", "127.0.0.1"} or hostname.endswith(".test")
        if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
            raise ValueError("Server URL ต้องใช้ HTTPS ยกเว้น localhost, 127.0.0.1 หรือ .test")
        if parsed.query or parsed.fragment or not hostname:
            raise ValueError("Server URL ไม่ถูกต้อง")

    def validate_agent_credentials(self) -> None:
        if not self.agent_key.strip() or not self.agent_secret:
            raise ValueError("กรอก Agent Key และ Agent Secret")

    def validate_jhcis(self) -> None:
        if not self.jhcis_host.strip() or not (1 <= self.jhcis_port <= 65535):
            raise ValueError("JHCIS host/port ไม่ถูกต้อง")
        if not self.jhcis_database.strip() or not self.jhcis_user.strip() or not self.jhcis_password:
            raise ValueError("กรอก Database, User และ Database password")
        if self.allowed_office_id and (
            not OFFICE_PATTERN.fullmatch(self.allowed_office_id) or self.allowed_office_id.startswith("0000")
        ):
            raise ValueError("รหัสสถานบริการที่อนุญาตต้องเป็นเลข 5 หลักและไม่ใช่ 0000x")


class ConfigStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or app_data_dir() / "config.json"

    def load(self) -> AgentConfig:
        if not self.path.exists():
            return AgentConfig.blank()
        data = json.loads(self.path.read_text(encoding="utf-8"))
        data["agent_secret"] = _crypt_unprotect(str(data.pop("agent_secret_dpapi")))
        data["jhcis_password"] = _crypt_unprotect(str(data.pop("jhcis_password_dpapi")))
        return AgentConfig(**data)

    def save(self, config: AgentConfig) -> None:
        config.validate()
        data = asdict(config)
        data["agent_secret_dpapi"] = _crypt_protect(str(data.pop("agent_secret")))
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
