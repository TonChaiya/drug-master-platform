from __future__ import annotations

import hashlib
import hmac

PROTOCOL = "v1"
REPORT_PATH = "/api/poc/agent/report"


def canonical_string(method: str, path: str, timestamp: str, nonce: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    return "\n".join((PROTOCOL, method, path, timestamp, nonce, body_hash))


def sign_request(secret: str, method: str, path: str, timestamp: str, nonce: str, body: bytes) -> str:
    canonical = canonical_string(method, path, timestamp, nonce, body).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
