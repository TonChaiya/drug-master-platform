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

    # 4. Copy and paste on a field, driven the way Windows actually delivers the
    #    keystroke. Tk's own Ctrl+C binding is keysym-based, so under the Thai
    #    layout the keysym is a Thai letter and nothing matches; the agent binds
    #    <Control-KeyPress> and reads the layout-independent keycode instead.
    #    Firing an event that carries the keycode but not the Latin keysym is
    #    the Thai case exactly.
    field = agent.entries["jhcis_database"]
    field.delete(0, "end")
    field.insert(0, "jhcisdb")
    # Tk will not deliver a generated key event to a widget that is not mapped
    # and focused, so the window has to be on screen for this part.
    agent.settings_window.deiconify()
    agent.settings_window.focus_force()
    root.update()
    field.focus_set()
    root.update()
    # CTkEntry is a frame around a real tk.Entry, and CTkEntry.bind attaches to
    # that inner widget — which is also where Windows delivers the keystroke.
    # Firing at the frame would test nothing.
    keyboard = field._entry
    keyboard.focus_force()
    root.update()

    root.clipboard_clear()
    keyboard.event_generate("<Control-KeyPress>", keycode=agent_app.VK_A, state=4)
    keyboard.event_generate("<Control-KeyPress>", keycode=agent_app.VK_C, state=4)
    root.update()
    try:
        copied = root.clipboard_get()
    except tk.TclError:
        copied = ""
    check(copied == "jhcisdb", f"Ctrl+C by keycode did not copy the field: {copied!r}")

    # Paste has to put it back into an empty field the same way.
    field.delete(0, "end")
    keyboard.event_generate("<Control-KeyPress>", keycode=agent_app.VK_V, state=4)
    root.update()
    check(field.get() == "jhcisdb", f"Ctrl+V by keycode did not paste: {field.get()!r}")

    # Select-all used entry.selection_range, which tk.Entry has and CTkEntry does
    # not, so this raised AttributeError every time it ran.
    check(hasattr(field, "select_range"), "CTkEntry lost select_range")

    # 5. The copy helper and the diagnostics block, which is what a user is asked
    #    to paste when reporting a problem.
    agent._copy("05957", "รหัส")
    root.update()
    check(root.clipboard_get() == "05957", "_copy did not reach the clipboard")
    report = agent._diagnostics()
    for expected in ("Installation ID", "MAC", "JHCIS", agent.config.installation_id):
        check(expected in report, f"diagnostics block is missing {expected}")

    # 6. The app's own enrolment call must match AgentApi.enroll. Version 1.2.1
    #    shipped with `self` referenced inside that @staticmethod and every
    #    enrolment died with a NameError; binding the arguments here fails on an
    #    arity or name drift without touching the network.
    import inspect

    from tmt_agent.api import AgentApi

    try:
        inspect.signature(AgentApi.enroll).bind(
            "https://central.test", "t" * 43, agent.config.installation_id, "WARD-PC", "05957", "1.0.0", "127.0.0.1"
        )
    except TypeError as error:
        check(False, f"AgentApi.enroll does not accept the arguments app.py passes: {error}")
finally:
    root.destroy()

if failures:
    for failure in failures:
        print("FAIL:", failure)
    raise SystemExit(1)

print("agent UI smoke OK")
