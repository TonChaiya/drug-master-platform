"""
Builds the real settings window and fires the callbacks that only run on rare
paths, because that is where the last three defects lived.

None of them were visible by reading the code, and none needed a person
clicking: a status update with the window open, an enrolment link arriving, and
the dashboard refresh. All three were reachable in under a second from here.

Nothing here touches the network or the real %LOCALAPPDATA%: the test points
LOCALAPPDATA at a temporary directory before importing the app, so it runs
against a blank config and writes its log there.

Run: python agent/windows/tests/test_ui_smoke.py
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

SANDBOX = tempfile.mkdtemp(prefix="tmt-agent-uitest-")
os.environ["LOCALAPPDATA"] = SANDBOX

import tkinter as tk  # noqa: E402

import app as agent_app  # noqa: E402
from tmt_agent.config import AgentConfig  # noqa: E402

LINK = "tmtagent://enroll?server=https://central.test&token=" + ("a" * 43) + "&facility=05957"

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


root = tk.Tk()
agent = agent_app.AgentApp(root, None)
try:
    agent.open_settings()
    root.update()

    # 1. set_status with the window open. This passed ttk's `foreground` to a
    #    CustomTkinter label, which raises; inside a Tk callback in a --windowed
    #    build the traceback went to a stderr that does not exist.
    for state in ("ok", "error", "busy", "idle"):
        agent.set_status(f"ทดสอบสถานะ {state} 188 รายการ", state)
    root.update()

    # 2. An enrolment link must overwrite the Server URL field. The write was
    #    guarded by isinstance(widget, tk.Entry), which silently stopped matching
    #    when the form moved to CustomTkinter, so the link's server was dropped
    #    and enrolment went to whatever was already typed.
    agent.handle_enrollment_link(LINK)
    root.update()
    check(agent.pending_enrollment is not None, "enrolment link was not staged")
    check(
        agent.entries["server_url"].get() == "https://central.test",
        f"Server URL field did not follow the link: {agent.entries['server_url'].get()!r}",
    )

    # The form must still be readable after the link rewrote a field.
    parsed = agent.config_from_form()
    check(parsed.server_url == "https://central.test", "config_from_form lost the link's server")

    # 3. The tiles are the part of the window whose only job is to show state,
    #    and they stayed on "—" after enrolling and syncing.
    agent.config = AgentConfig(
        installation_id=agent.config.installation_id,
        server_url="https://central.test",
        key_id="k",
        secret="s",
        facility_code="05957",
        machine_label="WARD-PC",
    )
    agent.last_sync_text = "03/09 08:40"
    agent._refresh_dashboard()
    root.update()
    check(agent.stat_facility.cget("text") == "05957", "facility tile did not follow the config")
    check(agent.stat_machine.cget("text") == "WARD-PC", "machine tile did not follow the config")
    check(agent.stat_sync.cget("text") == "03/09 08:40", "last-sync tile did not update")
finally:
    root.destroy()

if failures:
    for failure in failures:
        print("FAIL:", failure)
    raise SystemExit(1)

print("agent UI smoke OK")
