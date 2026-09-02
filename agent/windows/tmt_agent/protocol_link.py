from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

SCHEME = "tmtagent"
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


@dataclass(frozen=True)
class EnrollmentLink:
    server_url: str
    token: str
    facility_code: str


def parse_enrollment_link(value: str) -> EnrollmentLink:
    """Parses tmtagent://enroll?server=...&token=...&facility=NNNNN."""
    parsed = urlparse(value)
    if parsed.scheme != SCHEME:
        raise ValueError("ลิงก์ไม่ใช่ tmtagent://")
    if (parsed.netloc or parsed.path.strip("/")) != "enroll":
        raise ValueError("ลิงก์ลงทะเบียนไม่ถูกต้อง")

    query = parse_qs(parsed.query)
    server = (query.get("server") or [""])[0].strip().rstrip("/")
    token = (query.get("token") or [""])[0].strip()
    facility = (query.get("facility") or [""])[0].strip()

    if not TOKEN_PATTERN.fullmatch(token):
        raise ValueError("token ในลิงก์ไม่ถูกต้อง")
    if not re.fullmatch(r"\d{5}", facility) or facility.startswith("0000"):
        raise ValueError("รหัสสถานบริการในลิงก์ไม่ถูกต้อง")

    server_parsed = urlparse(server)
    hostname = (server_parsed.hostname or "").lower()
    local = hostname in {"localhost", "127.0.0.1"} or hostname.endswith(".test")
    if server_parsed.scheme != "https" and not (local and server_parsed.scheme == "http"):
        raise ValueError("Server URL ในลิงก์ต้องเป็น HTTPS")

    return EnrollmentLink(server_url=server, token=token, facility_code=facility)


def register_protocol_handler(executable_path: str) -> None:
    """Registers HKCU\\Software\\Classes\\tmtagent — per user, no admin rights needed."""
    import winreg

    root = winreg.HKEY_CURRENT_USER
    base = f"Software\\Classes\\{SCHEME}"
    with winreg.CreateKey(root, base) as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, "URL:TMT Drug Master Agent")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(root, f"{base}\\shell\\open\\command") as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, f'"{executable_path}" "%1"')


def unregister_protocol_handler() -> None:
    import winreg

    root = winreg.HKEY_CURRENT_USER
    for path in (
        f"Software\\Classes\\{SCHEME}\\shell\\open\\command",
        f"Software\\Classes\\{SCHEME}\\shell\\open",
        f"Software\\Classes\\{SCHEME}\\shell",
        f"Software\\Classes\\{SCHEME}",
    ):
        try:
            winreg.DeleteKey(root, path)
        except OSError:
            pass
