from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_ROOT))

from poc_agent.config import AgentConfig, ConfigStore  # noqa: E402


class ConfigDpapiTest(unittest.TestCase):
    def test_sensitive_values_are_dpapi_protected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            store = ConfigStore(path)
            config = AgentConfig(
                installation_id="123e4567-e89b-42d3-a456-426614174000",
                server_url="http://localhost:3100",
                agent_key="fixture-key",
                agent_secret="fixture-secret-value",
                jhcis_password="fixture-db-password",
                allowed_office_id="05957",
            )
            store.save(config)
            serialized = path.read_text(encoding="utf-8")
            self.assertNotIn("fixture-secret-value", serialized)
            self.assertNotIn("fixture-db-password", serialized)
            data = json.loads(serialized)
            self.assertIn("agent_secret_dpapi", data)
            self.assertIn("jhcis_password_dpapi", data)
            self.assertEqual(config, store.load())


if __name__ == "__main__":
    unittest.main()
