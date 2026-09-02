from __future__ import annotations

import json
import secrets
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests

from poc_agent.config import AgentConfig
from poc_agent.jhcis import JhcisResult
from poc_agent.security import REPORT_PATH, sign_request
from version import VERSION


class WebConnectionError(RuntimeError):
    def __init__(self, code: str, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class HealthResult:
    server_time: str
    version: str


@dataclass(frozen=True)
class ReportResult:
    request_id: str
    received_at: str


def _url(config: AgentConfig, path: str) -> str:
    return urljoin(config.server_url.rstrip("/") + "/", path.lstrip("/"))


def _request_error(error: requests.RequestException) -> WebConnectionError:
    if isinstance(error, requests.Timeout):
        return WebConnectionError("WEB_TIMEOUT", "Web API ตอบกลับเกินเวลาที่กำหนด")
    if isinstance(error, requests.exceptions.SSLError):
        return WebConnectionError("WEB_TLS", "ตรวจสอบ HTTPS/TLS certificate ไม่สำเร็จ")
    cause = error.__cause__
    if isinstance(cause, socket.gaierror) or "name resolution" in str(error).lower():
        return WebConnectionError("WEB_DNS", "ค้นหา DNS ของ Web API ไม่สำเร็จ")
    if "reset" in str(error).lower() or "remote end closed" in str(error).lower():
        return WebConnectionError("WEB_DISCONNECTED", "Web API ตัดการเชื่อมต่อ")
    return WebConnectionError("WEB_NETWORK", "ติดต่อ Web API ไม่สำเร็จ")


def _json(response: requests.Response) -> dict[str, object]:
    try:
        data = response.json()
    except requests.JSONDecodeError:
        raise WebConnectionError("WEB_INVALID_JSON", "Web API ส่ง JSON ที่อ่านไม่ได้", response.status_code) from None
    if not isinstance(data, dict):
        raise WebConnectionError("WEB_INVALID_JSON", "Web API ส่งข้อมูลผิดรูปแบบ", response.status_code)
    return data


def _send(method: str, url: str, **kwargs: object) -> requests.Response:
    last_error: requests.RequestException | None = None
    for attempt in range(2):
        try:
            return requests.request(method, url, timeout=(5, 15), **kwargs)
        except requests.RequestException as error:
            last_error = error
            if attempt == 0 and isinstance(error, (requests.Timeout, requests.ConnectionError)):
                time.sleep(0.35)
                continue
            break
    assert last_error is not None
    raise _request_error(last_error) from None


def test_web(config: AgentConfig) -> HealthResult:
    config.validate_server_url()
    response = _send("GET", _url(config, "/api/poc/health"), headers={"Accept": "application/json"})
    if response.status_code != 200:
        raise WebConnectionError("WEB_HTTP", f"Web API ตอบ HTTP {response.status_code}", response.status_code)
    data = _json(response)
    if data.get("ok") is not True or not isinstance(data.get("serverTime"), str) or not isinstance(data.get("version"), str):
        raise WebConnectionError("WEB_INVALID_RESPONSE", "Web API ส่ง health response ไม่ครบ", response.status_code)
    return HealthResult(server_time=str(data["serverTime"]), version=str(data["version"]))


def report_jhcis(config: AgentConfig, result: JhcisResult, machine_name: str) -> ReportResult:
    config.validate()
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    payload = {
        "installationId": config.installation_id,
        "machineName": machine_name[:128],
        "agentVersion": VERSION,
        "officeId": result.office_id,
        "jhcisConnected": True,
        "eligibleDrugCount": result.eligible_drug_count,
        "checkedAt": checked_at,
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    signature = sign_request(config.agent_secret, "POST", REPORT_PATH, timestamp, nonce, body)
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Agent-Key": config.agent_key,
        "X-Agent-Timestamp": timestamp,
        "X-Agent-Nonce": nonce,
        "X-Agent-Signature": signature,
        "X-Agent-Protocol": "1",
    }
    response = _send("POST", _url(config, REPORT_PATH), data=body, headers=headers)
    data = _json(response)
    if response.status_code in {401, 403, 409}:
        raise WebConnectionError("WEB_AUTH", "Web API ปฏิเสธ Agent credential/office/nonce", response.status_code)
    if response.status_code >= 500:
        raise WebConnectionError("WEB_REMOTE", "Web API ขัดข้องชั่วคราว", response.status_code)
    if response.status_code != 202 or data.get("ok") is not True:
        raise WebConnectionError("WEB_HTTP", f"Web API ตอบ HTTP {response.status_code}", response.status_code)
    request_id = data.get("requestId")
    received_at = data.get("receivedAt")
    if not isinstance(request_id, str) or not isinstance(received_at, str):
        raise WebConnectionError("WEB_INVALID_RESPONSE", "Web API ส่งผลรายงานไม่ครบ", response.status_code)
    return ReportResult(request_id=request_id, received_at=received_at)
