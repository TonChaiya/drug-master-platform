from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import tkinter as tk
from collections.abc import Callable
from dataclasses import replace
from logging.handlers import RotatingFileHandler
from tkinter import messagebox, ttk

import pystray
from PIL import Image, ImageDraw

from tmt_agent.api import AgentApi
from tmt_agent.config import AgentConfig, ConfigStore, app_data_dir
from tmt_agent.errors import AgentFailure
from tmt_agent.jhcis import read_office
from tmt_agent.protocol_link import parse_enrollment_link, register_protocol_handler
from tmt_agent.single_instance import IpcServer, SingleInstance, send_to_running_instance
from tmt_agent.worker import CommandWorker, run_sync
from version import VERSION

APP_NAME = "TMT Drug Master Agent"
STATE_COLORS = {"ok": "#087c5b", "error": "#b42318", "busy": "#c58a00", "idle": "#64748b"}


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tmt-agent")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = RotatingFileHandler(app_data_dir() / "agent.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    return logger


def create_icon(color: str) -> Image.Image:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((6, 6, 58, 58), radius=14, fill=color)
    draw.rectangle((19, 29, 45, 35), fill="white")
    draw.rectangle((29, 19, 35, 45), fill="white")
    return image


class AgentApp:
    def __init__(self, root: tk.Tk, pending_link: str | None) -> None:
        self.root = root
        self.root.withdraw()
        self.logger = setup_logger()
        self.store = ConfigStore()
        self.config = self._load_config()
        self.status_text = "พร้อมทำงาน" if self.config.enrolled else "ยังไม่ได้ลงทะเบียน"
        self.status_state = "idle" if self.config.enrolled else "error"
        self.settings_window: tk.Toplevel | None = None
        self.entries: dict[str, tk.Widget] = {}
        self.settings_status: ttk.Label | None = None

        self.pending_enrollment: object | None = None
        self.worker = CommandWorker(self.store, VERSION, self._on_status, self._on_config_reloaded)
        self.ipc = IpcServer(self._on_ipc_message)

        self.icon = pystray.Icon(
            "TMTDrugMasterAgent",
            create_icon(STATE_COLORS[self.status_state]),
            f"{APP_NAME} - {self.status_text}",
            menu=pystray.Menu(
                pystray.MenuItem(lambda _item: f"สถานะ: {self.status_text}", None, enabled=False),
                pystray.MenuItem("เปิดหน้าตั้งค่า", lambda _icon, _item: self.root.after(0, self.open_settings), default=True),
                pystray.MenuItem("ทดสอบการเชื่อมต่อ", lambda _icon, _item: self.root.after(0, self.test_connection)),
                pystray.MenuItem("ดึงรายการยาตอนนี้", lambda _icon, _item: self.root.after(0, self.sync_now)),
                pystray.MenuItem("เปิด log", lambda _icon, _item: self.open_log()),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("ออกจากโปรแกรม", lambda _icon, _item: self.root.after(0, self.quit)),
            ),
        )
        self.pending_link = pending_link

    # ---------------------------------------------------------------- config

    def _load_config(self) -> AgentConfig:
        try:
            return self.store.load()
        except (OSError, ValueError, KeyError, TypeError):
            messagebox.showwarning(APP_NAME, "อ่านการตั้งค่าเดิมไม่สำเร็จ กรุณาตั้งค่าใหม่")
            return AgentConfig.blank()

    def _on_config_reloaded(self, config: AgentConfig) -> None:
        self.config = config
        self.root.after(0, self._refresh_form)

    def _persist(self, config: AgentConfig) -> None:
        self.store.save(config)
        self.config = config
        self.worker.replace_config(config)

    # ---------------------------------------------------------------- status

    def _on_status(self, text: str, state: str) -> None:
        self.root.after(0, lambda: self.set_status(text, state))

    def set_status(self, text: str, state: str = "idle") -> None:
        self.status_text = text[:150]
        self.status_state = state
        color = STATE_COLORS.get(state, STATE_COLORS["idle"])
        self.icon.icon = create_icon(color)
        self.icon.title = f"{APP_NAME} - {self.status_text}"
        if self.settings_status is not None and self.settings_status.winfo_exists():
            self.settings_status.configure(text=self.status_text, foreground=color)

    # ------------------------------------------------------------------- ipc

    def _on_ipc_message(self, message: dict[str, object]) -> None:
        if message.get("type") == "enroll" and isinstance(message.get("url"), str):
            self.root.after(0, lambda: self.handle_enrollment_link(str(message["url"])))

    # ------------------------------------------------------------ enrollment

    def handle_enrollment_link(self, url: str) -> None:
        try:
            link = parse_enrollment_link(url)
        except ValueError as error:
            self.set_status(str(error), "error")
            self.open_settings()
            return

        self.open_settings()
        self.set_status("ได้รับลิงก์ลงทะเบียน กรุณาตรวจการตั้งค่า JHCIS แล้วกด “ลงทะเบียน”", "busy")
        self.pending_enrollment = link
        if isinstance(self.entries.get("server_url"), tk.Entry):
            widget = self.entries["server_url"]
            assert isinstance(widget, tk.Entry)
            widget.delete(0, tk.END)
            widget.insert(0, link.server_url)

    def enroll_action(self) -> None:
        link = self.pending_enrollment
        if link is None:
            self.set_status("ยังไม่มีลิงก์ลงทะเบียน กรุณาเปิดลิงก์จากหน้าเว็บบนเครื่องนี้", "error")
            return

        def work() -> str:
            config = self.config_from_form()
            snapshot = read_office(config)
            if snapshot.office_id != link.facility_code:
                raise AgentFailure(
                    "JHCIS_OFFICE_MISMATCH",
                    f"office.offid ({snapshot.office_id}) ไม่ตรงกับสถานบริการของลิงก์ ({link.facility_code})",
                )
            credential = AgentApi.enroll(
                link.server_url,
                link.token,
                config.installation_id,
                config.machine_label or socket.gethostname(),
                snapshot.office_id,
                VERSION,
            )
            self._persist(
                config.with_credential(link.server_url, credential.key_id, credential.secret, credential.facility_code)
            )
            self.pending_enrollment = None
            self.worker.wake()
            return f"ลงทะเบียนสำเร็จกับสถานบริการ {credential.facility_code}"

        self.run_worker("กำลังลงทะเบียน…", work)

    # ---------------------------------------------------------------- actions

    def test_connection(self) -> None:
        def work() -> str:
            snapshot = read_office(self.config_from_form())
            return f"JHCIS พร้อม office {snapshot.office_id} · ยา 01/10 {snapshot.eligible_drug_count:,} รายการ"

        self.run_worker("กำลังทดสอบ JHCIS…", work)

    def sync_now(self) -> None:
        def work() -> str:
            outcome = run_sync(self.config, VERSION, lambda text: self._on_status(text, "busy"))
            return f"ส่ง {outcome.received:,} รายการ (เพิ่ม {outcome.inserted:,} แก้ไข {outcome.updated:,} ปิดใช้ {outcome.deactivated:,})"

        self.run_worker("กำลังดึงและส่งรายการยา…", work)

    def run_worker(self, label: str, work: Callable[[], str]) -> None:
        self.set_status(label, "busy")

        def runner() -> None:
            try:
                message = work()
                self.logger.info("operation_success")
                self._on_status(message, "ok")
            except (AgentFailure, ValueError) as error:
                code = getattr(error, "code", "CONFIG_INVALID")
                self.logger.warning("operation_failed code=%s", code)
                self._on_status(str(error), "error")
            except Exception:
                self.logger.exception("operation_failed code=UNEXPECTED")
                self._on_status("เกิดข้อผิดพลาดที่ไม่คาดคิด โปรดเปิด log", "error")

        threading.Thread(target=runner, daemon=True).start()

    # ------------------------------------------------------------------- form

    def _entry(self, parent: ttk.Frame, row: int, key: str, label: str, value: str, secret: bool = False) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 10), pady=3)
        entry = ttk.Entry(parent, show="•" if secret else "")
        entry.grid(row=row, column=1, sticky="ew", pady=3)
        entry.insert(0, value)
        self._enable_clipboard(entry)
        self.entries[key] = entry

    def _enable_clipboard(self, entry: ttk.Entry) -> None:
        menu = tk.Menu(entry, tearoff=False)
        menu.add_command(label="ตัด", command=lambda: entry.event_generate("<<Cut>>"))
        menu.add_command(label="คัดลอก", command=lambda: entry.event_generate("<<Copy>>"))
        menu.add_command(label="วาง", command=lambda: entry.event_generate("<<Paste>>"))

        def popup(event: "tk.Event[ttk.Entry]") -> str:
            entry.focus_set()
            menu.tk_popup(event.x_root, event.y_root)
            return "break"

        entry.bind("<Button-3>", popup)
        entry.bind("<Control-a>", lambda _event: (entry.selection_range(0, tk.END), entry.icursor(tk.END), "break")[-1])

    def _refresh_form(self) -> None:
        if self.settings_window is None or not self.settings_window.winfo_exists():
            return
        values = {
            "server_url": self.config.server_url,
            "machine_label": self.config.machine_label or socket.gethostname(),
            "jhcis_host": self.config.jhcis_host,
            "jhcis_port": str(self.config.jhcis_port),
            "jhcis_database": self.config.jhcis_database,
            "jhcis_user": self.config.jhcis_user,
            "jhcis_password": self.config.jhcis_password,
        }
        for key, value in values.items():
            widget = self.entries.get(key)
            if isinstance(widget, ttk.Entry):
                widget.delete(0, tk.END)
                widget.insert(0, value)

    def open_settings(self) -> None:
        if self.settings_window is not None and self.settings_window.winfo_exists():
            self.settings_window.deiconify()
            self.settings_window.lift()
            self.settings_window.focus_force()
            return

        window = tk.Toplevel(self.root)
        self.settings_window = window
        window.title(f"{APP_NAME} v{VERSION}")
        window.geometry("660x560")
        window.minsize(600, 520)
        window.protocol("WM_DELETE_WINDOW", window.withdraw)

        frame = ttk.Frame(window, padding=16)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(1, weight=1)

        ttk.Label(frame, text="การเชื่อมต่อ JHCIS", font=("Segoe UI", 15, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(
            frame,
            text="รหัสผ่านฐานข้อมูลถูกเก็บด้วย Windows DPAPI บนเครื่องนี้เท่านั้น ไม่ถูกส่งขึ้นระบบกลาง",
            foreground="#64748b",
            wraplength=600,
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(2, 12))

        self.entries = {}
        self._entry(frame, 2, "jhcis_host", "JHCIS Host / IP", self.config.jhcis_host)
        self._entry(frame, 3, "jhcis_port", "Port", str(self.config.jhcis_port))
        self._entry(frame, 4, "jhcis_database", "Database", self.config.jhcis_database)
        self._entry(frame, 5, "jhcis_user", "User", self.config.jhcis_user)
        self._entry(frame, 6, "jhcis_password", "Database password", self.config.jhcis_password, True)
        self._entry(frame, 7, "server_url", "Server URL", self.config.server_url)
        self._entry(frame, 8, "machine_label", "ชื่อเครื่อง", self.config.machine_label or socket.gethostname())

        info = (
            f"Installation ID: {self.config.installation_id}\n"
            f"สถานบริการที่ลงทะเบียน: {self.config.facility_code or '— ยังไม่ได้ลงทะเบียน —'}"
        )
        ttk.Label(frame, text=info, foreground="#64748b", justify="left").grid(row=9, column=0, columnspan=2, sticky="w", pady=(10, 4))

        self.settings_status = ttk.Label(frame, text=self.status_text, foreground=STATE_COLORS[self.status_state], wraplength=600)
        self.settings_status.grid(row=10, column=0, columnspan=2, sticky="w", pady=(4, 10))

        buttons = ttk.Frame(frame)
        buttons.grid(row=11, column=0, columnspan=2, sticky="ew")
        ttk.Button(buttons, text="ทดสอบ JHCIS", command=self.test_connection).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="ลงทะเบียน", command=self.enroll_action).pack(side="left", padx=6)
        ttk.Button(buttons, text="ดึงรายการยาตอนนี้", command=self.sync_now).pack(side="left", padx=6)
        ttk.Button(buttons, text="บันทึกและย่อไป Tray", command=self.save_and_hide).pack(side="right")

    def config_from_form(self) -> AgentConfig:
        if not self.entries:
            return self.config
        def text(key: str) -> str:
            widget = self.entries[key]
            assert isinstance(widget, ttk.Entry)
            return widget.get()

        try:
            port = int(text("jhcis_port").strip())
        except ValueError:
            raise ValueError("Port ต้องเป็นตัวเลข") from None

        return replace(
            self.config,
            server_url=text("server_url").strip().rstrip("/"),
            machine_label=text("machine_label").strip()[:128],
            jhcis_host=text("jhcis_host").strip(),
            jhcis_port=port,
            jhcis_database=text("jhcis_database").strip(),
            jhcis_user=text("jhcis_user").strip(),
            jhcis_password=text("jhcis_password"),
        )

    def save_and_hide(self) -> None:
        try:
            self._persist(self.config_from_form())
            self.logger.info("config_saved")
            self.set_status("บันทึกการตั้งค่าแล้ว", "ok")
            if self.settings_window is not None:
                self.settings_window.withdraw()
        except (OSError, ValueError) as error:
            self.logger.warning("config_save_failed")
            self.set_status(str(error), "error")

    def open_log(self) -> None:
        os.startfile(app_data_dir() / "agent.log")

    def quit(self) -> None:
        self.worker.stop()
        self.ipc.stop()
        self.icon.stop()
        self.root.quit()
        self.root.destroy()

    def run(self) -> None:
        self.icon.run_detached()
        self.ipc.start()
        self.worker.start()
        if self.pending_link:
            self.root.after(200, lambda: self.handle_enrollment_link(str(self.pending_link)))
        elif not self.config.enrolled:
            self.root.after(250, self.open_settings)
        self.root.mainloop()


def main() -> int:
    if "--version" in sys.argv:
        print(VERSION)
        return 0
    if "--register-protocol" in sys.argv:
        register_protocol_handler(sys.executable)
        return 0

    link = next((argument for argument in sys.argv[1:] if argument.startswith("tmtagent://")), None)

    instance = SingleInstance()
    if instance.already_running:
        # Hand the link to the running tray so it reloads its own config instead
        # of a second process writing settings the first one never re-reads.
        if link and send_to_running_instance({"type": "enroll", "url": link}):
            instance.close()
            return 0
        if "--startup" not in sys.argv:
            root = tk.Tk()
            root.withdraw()
            messagebox.showinfo(APP_NAME, "Agent ทำงานอยู่แล้วใน System Tray")
            root.destroy()
        instance.close()
        return 0

    try:
        register_protocol_handler(sys.executable)
    except OSError:
        pass

    try:
        root = tk.Tk()
        AgentApp(root, link).run()
        return 0
    finally:
        instance.close()


if __name__ == "__main__":
    raise SystemExit(main())
