from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = AGENT_ROOT.parents[1]
sys.path.insert(0, str(AGENT_ROOT))

from poc_agent.security import canonical_string, sign_request  # noqa: E402


class HmacVectorTest(unittest.TestCase):
    def test_matches_shared_typescript_vector(self) -> None:
        vector_path = PROJECT_ROOT / "tests" / "fixtures" / "hmac-vector.json"
        vector = json.loads(vector_path.read_text(encoding="utf-8"))
        body = vector["body"].encode("utf-8")
        canonical = canonical_string(vector["method"], vector["path"], vector["timestamp"], vector["nonce"], body)
        self.assertEqual(6, len(canonical.split("\n")))
        self.assertEqual(
            vector["signature"],
            sign_request(vector["secret"], vector["method"], vector["path"], vector["timestamp"], vector["nonce"], body),
        )


if __name__ == "__main__":
    unittest.main()
