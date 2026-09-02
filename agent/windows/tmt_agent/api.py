from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import requests

from tmt_agent.config import AgentConfig
from tmt_agent.errors import ServerFailure
from tmt_agent.security import PROTOCOL, new_nonce, new_timestamp, sign_request

TIMEOUT = (8, 45)
MAX_BODY_BYTES = 900 * 1024  # stay under the 1 MiB server limit


def _encode(payload: dict[str, Any]) -> bytes:
    # separators matter: the HMAC covers these exact bytes.
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _parse(response: requests.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        raise ServerFailure("SERVER_BAD_RESPONSE", f"เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP {response.status_code})") from None
    if not isinstance(body, dict):
        raise ServerFailure("SERVER_BAD_RESPONSE", "เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ")
    if not response.ok or not body.get("ok"):
        raise ServerFailure(str(body.get("errorCode") or f"HTTP_{response.status_code}"), str(body.get("message") or "เซิร์ฟเวอร์ปฏิเสธคำขอ"))
    return body


@dataclass(frozen=True)
class IssuedCredential:
    key_id: str
    secret: str
    facility_code: str


class AgentApi:
    """Signed client for the /api/v1/agent endpoints."""

    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.session = requests.Session()

    def _post_signed(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.config.enrolled:
            raise ServerFailure("AGENT_NOT_ENROLLED", "ยังไม่ได้ลงทะเบียน Agent กับเซิร์ฟเวอร์")
        body = _encode(payload)
        if len(body) > MAX_BODY_BYTES:
            raise ServerFailure("AGENT_PAYLOAD_TOO_LARGE", "ข้อมูลชุดนี้ใหญ่เกินกำหนด")
        timestamp = new_timestamp()
        nonce = new_nonce()
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Protocol": PROTOCOL,
            "X-Agent-Key": self.config.key_id,
            "X-Agent-Timestamp": timestamp,
            "X-Agent-Nonce": nonce,
            "X-Agent-Signature": sign_request(self.config.secret, "POST", path, timestamp, nonce, body),
        }
        try:
            response = self.session.post(
                f"{self.config.server_url}{path}", data=body, headers=headers, timeout=TIMEOUT, verify=True
            )
        except requests.RequestException:
            raise ServerFailure("SERVER_UNREACHABLE", "ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ") from None
        return _parse(response)

    @staticmethod
    def enroll(server_url: str, token: str, installation_id: str, machine_label: str, office_id: str, agent_version: str) -> IssuedCredential:
        """Unsigned: the agent has no credential yet, only the one-time token."""
        payload = {
            "enrollmentToken": token,
            "installationId": installation_id,
            "machineLabel": machine_label,
            "officeId": office_id,
            "agentVersion": agent_version,
        }
        try:
            response = requests.post(
                f"{server_url.rstrip('/')}/api/v1/agent/enroll",
                data=_encode(payload),
                headers={"Content-Type": "application/json"},
                timeout=TIMEOUT,
                verify=True,
            )
        except requests.RequestException:
            raise ServerFailure("SERVER_UNREACHABLE", "ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ") from None
        body = _parse(response)
        return IssuedCredential(str(body["keyId"]), str(body["secret"]), str(body["facilityCode"]))

    def poll_command(self, office_id: str, agent_version: str) -> dict[str, Any] | None:
        body = self._post_signed(
            "/api/v1/agent/commands/poll",
            {"installationId": self.config.installation_id, "officeId": office_id, "agentVersion": agent_version},
        )
        command = body.get("command")
        return command if isinstance(command, dict) else None

    def complete_command(self, command_id: str, claim_token: str, success: bool, result_code: str, result_message: str) -> None:
        self._post_signed(
            "/api/v1/agent/commands/complete",
            {
                "installationId": self.config.installation_id,
                "commandId": command_id,
                "claimToken": claim_token,
                "success": success,
                "resultCode": result_code[:48],
                "resultMessage": result_message[:500],
            },
        )

    def sync_begin(self, office_id: str, expected_rows: int, agent_version: str) -> tuple[str, int]:
        body = self._post_signed(
            "/api/v1/agent/sync/begin",
            {
                "installationId": self.config.installation_id,
                "officeId": office_id,
                "expectedRows": expected_rows,
                "agentVersion": agent_version,
            },
        )
        return str(body["sessionId"]), int(body.get("batchSize") or 300)

    def sync_batch(self, session_id: str, office_id: str, rows: list[dict[str, Any]]) -> int:
        body = self._post_signed(
            "/api/v1/agent/sync/batch",
            {
                "installationId": self.config.installation_id,
                "sessionId": session_id,
                "officeId": office_id,
                "rows": rows,
            },
        )
        return int(body.get("receivedRows") or 0)

    def sync_finish(self, session_id: str, office_id: str) -> dict[str, Any]:
        return self._post_signed(
            "/api/v1/agent/sync/finish",
            {"installationId": self.config.installation_id, "sessionId": session_id, "officeId": office_id},
        )
