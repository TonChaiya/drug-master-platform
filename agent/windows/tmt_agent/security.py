from __future__ import annotations

import hashlib
import hmac
import secrets
import time

PROTOCOL = "1"
CANONICAL_PREFIX = "v1"


def canonical_string(method: str, path: str, timestamp: str, nonce: str, body: bytes) -> str:
    """Must match src/modules/agent/signature.ts byte for byte."""
    return "\n".join((CANONICAL_PREFIX, method, path, timestamp, nonce, hashlib.sha256(body).hexdigest()))


def sign_request(secret: str, method: str, path: str, timestamp: str, nonce: str, body: bytes) -> str:
    canonical = canonical_string(method, path, timestamp, nonce, body).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def new_nonce() -> str:
    return secrets.token_hex(16)


def new_timestamp() -> str:
    return str(int(time.time()))
