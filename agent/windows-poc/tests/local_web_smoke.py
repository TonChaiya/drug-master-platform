from __future__ import annotations

import os
import socket
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_ROOT))

from poc_agent.config import AgentConfig  # noqa: E402
from poc_agent.jhcis import JhcisResult  # noqa: E402
from poc_agent.web import report_jhcis, test_web  # noqa: E402


def main() -> int:
    server_url = os.environ.get("POC_SMOKE_SERVER_URL", "http://localhost:3100")
    key = os.environ["POC_AGENT_KEY"]
    secret = os.environ["POC_AGENT_SECRET"]
    config = AgentConfig(
        installation_id="123e4567-e89b-42d3-a456-426614174000",
        server_url=server_url,
        agent_key=key,
        agent_secret=secret,
        jhcis_password="synthetic-not-used",
        allowed_office_id="05957",
    )
    health = test_web(config)
    report = report_jhcis(config, JhcisResult("05957", 123), socket.gethostname())
    print(f"health=PASS version={health.version}")
    print(f"signed-report=PASS requestId={report.request_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
