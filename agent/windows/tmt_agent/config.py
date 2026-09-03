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


# Picking an adapter, not calling uuid.getnode(). getnode() returns whichever
# address it finds first, and on a real machine that was the Bluetooth PAN
# adapter (B4:6D:83:13:0C:0D) while the Wi-Fi card actually carrying the LAN was
# B4:6D:83:13:0C:09. A MAC that names the wrong adapter is worse than no MAC,
# because it looks correct and matches nothing in the router's DHCP table.
MAX_ADAPTER_NAME_LENGTH = 256
MAX_ADAPTER_DESCRIPTION_LENGTH = 128
MAX_ADAPTER_ADDRESS_LENGTH = 8

# Present on almost every machine and useless for identification: they appear and
# disappear, and several of them share one vendor prefix with the real card.
VIRTUAL_ADAPTER = re.compile(
    r"bluetooth|wi-?fi direct|virtual|vmware|hyper-v|vbox|tap-|tunnel|loopback|wan miniport|docker|zerotier|tailscale",
    re.IGNORECASE,
)


class IpAddressString(ctypes.Structure):
    _fields_ = [("String", ctypes.c_char * 16)]


class IpAddrString(ctypes.Structure):
    pass


IpAddrString._fields_ = [
    ("Next", ctypes.POINTER(IpAddrString)),
    ("IpAddress", IpAddressString),
    ("IpMask", IpAddressString),
    ("Context", wintypes.DWORD),
]


class IpAdapterInfo(ctypes.Structure):
    pass


# Trailing lease timestamps are declared for completeness only; the list is
# walked through Next pointers, so their width never affects traversal.
IpAdapterInfo._fields_ = [
    ("Next", ctypes.POINTER(IpAdapterInfo)),
    ("ComboIndex", wintypes.DWORD),
    ("AdapterName", ctypes.c_char * (MAX_ADAPTER_NAME_LENGTH + 4)),
    ("Description", ctypes.c_char * (MAX_ADAPTER_DESCRIPTION_LENGTH + 4)),
    ("AddressLength", ctypes.c_uint),
    ("Address", ctypes.c_ubyte * MAX_ADAPTER_ADDRESS_LENGTH),
    ("Index", wintypes.DWORD),
    ("Type", ctypes.c_uint),
    ("DhcpEnabled", ctypes.c_uint),
    ("CurrentIpAddress", ctypes.POINTER(IpAddrString)),
    ("IpAddressList", IpAddrString),
    ("GatewayList", IpAddrString),
    ("DhcpServer", IpAddrString),
    ("HaveWins", wintypes.BOOL),
    ("PrimaryWinsServer", IpAddrString),
    ("SecondaryWinsServer", IpAddrString),
    ("LeaseObtained", ctypes.c_int64),
    ("LeaseExpires", ctypes.c_int64),
]


@dataclass(frozen=True)
class NetworkAdapter:
    mac: str
    description: str
    addresses: tuple[str, ...]
    has_gateway: bool


def _chain(first: IpAddrString) -> list[str]:
    values: list[str] = []
    entry = first
    while True:
        text = entry.IpAddress.String.decode("ascii", "ignore")
        if text and text != "0.0.0.0":
            values.append(text)
        if not entry.Next:
            return values
        entry = entry.Next.contents


def list_adapters() -> list[NetworkAdapter]:
    """Every IPv4-capable adapter Windows knows about, with its own MAC."""
    iphlpapi = ctypes.windll.iphlpapi
    size = wintypes.ULONG(0)
    iphlpapi.GetAdaptersInfo(None, ctypes.byref(size))
    if not size.value:
        return []
    buffer = ctypes.create_string_buffer(size.value)
    head = ctypes.cast(buffer, ctypes.POINTER(IpAdapterInfo))
    if iphlpapi.GetAdaptersInfo(head, ctypes.byref(size)) != 0:
        return []

    adapters: list[NetworkAdapter] = []
    node = head
    while node:
        entry = node.contents
        if entry.AddressLength == 6:
            adapters.append(
                NetworkAdapter(
                    mac=":".join("%02X" % byte for byte in entry.Address[:6]),
                    description=entry.Description.decode("mbcs", "ignore"),
                    addresses=tuple(_chain(entry.IpAddressList)),
                    has_gateway=bool(_chain(entry.GatewayList)),
                )
            )
        node = entry.Next
    return adapters


def _route_source_ip(host: str | None) -> str | None:
    """
    The local address Windows would use to reach `host`.

    A UDP socket is connected but nothing is sent: this only asks the routing
    table which adapter would carry the traffic, so it costs nothing and works
    while the host is switched off.
    """
    import socket

    for target in (host, "8.8.8.8"):
        if not target:
            continue
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                probe.connect((target, 9))
                address = probe.getsockname()[0]
            finally:
                probe.close()
        except OSError:
            continue
        # A JHCIS on this same PC routes over loopback, which belongs to no
        # adapter; ask again for the route off the machine instead.
        if address and not address.startswith("127."):
            return address
    return None


def machine_mac(prefer_host: str | None = None) -> str | None:
    """
    The MAC of the adapter this PC uses on the รพ.สต. LAN.

    Chosen by route rather than by enumeration order: the adapter holding the
    address that would reach JHCIS is the one the router and the JHCIS server
    see, so it is the one an admin can match against a DHCP table.

    Best-effort - a failure here must never stop an enrolment, so it reports
    nothing rather than raising.
    """
    try:
        adapters = list_adapters()
        if not adapters:
            return None

        source = _route_source_ip(prefer_host)
        if source:
            for adapter in adapters:
                if source in adapter.addresses:
                    return adapter.mac

        # Nothing routable right now (cable out, JHCIS unreachable). Fall back to
        # the most plausible physical card so a machine that is offline at
        # enrolment still reports a stable address.
        best = min(
            adapters,
            key=lambda adapter: (
                bool(VIRTUAL_ADAPTER.search(adapter.description)),
                not adapter.has_gateway,
                not adapter.addresses,
            ),
        )
        return None if VIRTUAL_ADAPTER.search(best.description) else best.mac
    except Exception:  # noqa: BLE001 - identification must never break enrolment
        return None


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
