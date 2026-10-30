from __future__ import annotations

import unittest
from unittest.mock import patch

from tmt_agent.api import AgentApi
from tmt_agent.config import AgentConfig


class HeartbeatTests(unittest.TestCase):
    def test_poll_reports_jhcis_unreachable_without_office_id(self) -> None:
        config = AgentConfig(
            installation_id="11111111-1111-4111-8111-111111111111",
            server_url="https://central.test",
            key_id="key-key-key-key-key1",
            secret="secret",
            facility_code="05957",
        )
        api = AgentApi(config)
        captured: dict[str, object] = {}

        def fake_post(path: str, body: dict[str, object]) -> dict[str, object]:
            captured.update({"path": path, "body": body})
            return {"command": None}

        with patch.object(api, "_post_signed", side_effect=fake_post), patch(
            "tmt_agent.api.machine_ip", return_value="192.0.2.10"
        ), patch("tmt_agent.api.machine_mac", return_value="00:11:22:33:44:55"):
            self.assertIsNone(api.poll_command(None, "1.2.3", False))

        self.assertEqual(captured["path"], "/api/v1/agent/commands/poll")
        body = captured["body"]
        assert isinstance(body, dict)
        self.assertIsNone(body["officeId"])
        self.assertFalse(body["jhcisConnected"])
        self.assertEqual(body["ipAddress"], "192.0.2.10")


if __name__ == "__main__":
    unittest.main()
