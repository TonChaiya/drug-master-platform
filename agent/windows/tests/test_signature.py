"""
Known-answer check for the agent request signature.

The server computes the same HMAC in src/modules/agent/signature.ts. If either
side changes the canonical string, that side's copy of this vector fails and the
break is caught here instead of as a blanket AGENT_SIGNATURE_INVALID in the
field. scripts/check-agent-signature.mjs asserts the same vector on the server.

Run: python agent/windows/tests/test_signature.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tmt_agent.security import sign_request  # noqa: E402

SECRET = "test-secret-not-a-real-key"
METHOD = "POST"
PATH = "/api/v1/agent/sync/begin"
TIMESTAMP = "1767225600"
NONCE = "0123456789abcdef0123456789abcdef"
BODY = b'{"installationId":"11111111-1111-4111-8111-111111111111","officeId":"05957"}'
EXPECTED = "17f4ee3274d3d30c0884b106a3b9be7570ebc7690e9176ec291679ce26312160"

actual = sign_request(SECRET, METHOD, PATH, TIMESTAMP, NONCE, BODY)
assert actual == EXPECTED, f"signature drifted\n  expected {EXPECTED}\n  actual   {actual}"
print("agent signature vector OK")
