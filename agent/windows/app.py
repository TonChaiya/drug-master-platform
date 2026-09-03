from __future__ import annotations

import logging
from datetime import datetime
import os
import socket
import sys
import threading
import tkinter as tk

import customtkinter as ctk
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

# Same palette as the web app so the two do not look like different products.
INK = "#26384b"
PAPER = "#eef2f4"
LINE = "#dce3e7"
MUTED = "#73808b"
ORANGE = "#ff4d24"
ORANGE_DARK = "#e63d17"

ctk.set_appearance_mode("light")
ctk.set_default_color_theme("blue")


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
        self.last_sync_text = "—"
        # Tk prints callback exceptions to stderr, which a --windowed build
        # discards. An enrolment click that failed this way left the agent
        # looking like it had simply ignored the link.
        self.root.report_callback_exception = self._log_callback_exception
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
            config = self.store.load()
        except (OSError, ValueError, KeyError, TypeError) as error:
            # Logged, not just shown: the dialog is gone the moment it is
            # dismissed, and this is the first thing to check afterwards.
            self.logger.warning("config_unreadable path=%s error=%s", self.store.path, type(error).__name__)
            messagebox.showwarning(APP_NAME, "อ่านการตั้งค่าเดิมไม่สำเร็จ กรุณาตั้งค่าใหม่")
            return AgentConfig.blank()
        self.logger.info(
            "config_loaded enrolled=%s server=%s facility=%s jhcis=%s:%s/%s",
            config.enrolled,
            config.server_url or "-",
            config.facility_code or "-",
            config.jhcis_host,
            config.jhcis_port,
            config.jhcis_database,
        )
        return config

    def _on_config_reloaded(self, config: AgentConfig) -> None:
        self.config = config
        self.root.after(0, self._refresh_form)

    def _persist(self, config: AgentConfig) -> None:
        self.store.save(config)
        self.config = config
        self.worker.replace_config(config)
        # Enrolment changes the facility, so the tiles have to follow it.
        self.root.after(0, self._refresh_dashboard)

    # ---------------------------------------------------------------- status

    def _on_status(self, text: str, state: str) -> None:
        self.root.after(0, lambda: self.set_status(text, state))

    def set_status(self, text: str, state: str = "idle") -> None:
        self.status_text = text[:150]
        self.status_state = state
        if state == "ok" and "รายการ" in text:
            self.last_sync_text = datetime.now().strftime("%d/%m %H:%M")
            self._refresh_dashboard()
        color = STATE_COLORS.get(state, STATE_COLORS["idle"])
        self.icon.icon = create_icon(color)
        self.icon.title = f"{APP_NAME} - {self.status_text}"
        if self.settings_status is not None and self.settings_status.winfo_exists():
            # CustomTkinter names this text_color; ttk's `foreground` raises here.
            self.settings_status.configure(text=self.status_text, text_color=color)

    # ------------------------------------------------------------------- ipc

    def _log_callback_exception(self, exc_type, value, traceback_object) -> None:
        self.logger.error("ui_callback_failed", exc_info=(exc_type, value, traceback_object))
        self.set_status(f"เกิดข้อผิดพลาดในหน้าจอ: {value}", "error")

    def _on_ipc_message(self, message: dict[str, object]) -> None:
        if message.get("type") == "enroll" and isinstance(message.get("url"), str):
            self.logger.info("enrollment_link_received via=ipc")
            self.root.after(0, lambda: self.handle_enrollment_link(str(message["url"])))

    # ------------------------------------------------------------ enrollment

    def handle_enrollment_link(self, url: str) -> None:
        try:
            link = parse_enrollment_link(url)
        except ValueError as error:
            self.logger.warning("enrollment_link_invalid error=%s", error)
            self.set_status(str(error), "error")
            self.open_settings()
            return

        self.logger.info("enrollment_link_parsed server=%s facility=%s", link.server_url, link.facility_code)
        self.pending_enrollment = link
        self.open_settings()

        # The link carries the server it came from; the field must follow it.
        # This used to be guarded by isinstance(widget, tk.Entry), which stopped
        # matching when the form moved to CustomTkinter, so the link's server was
        # silently ignored and enrolment went to whatever was already typed.
        widget = self.entries.get("server_url")
        if widget is not None and hasattr(widget, "delete"):
            widget.delete(0, tk.END)
            widget.insert(0, link.server_url)

        # Clicking "connect" on the web should finish the job. Only stop for the
        # operator when JHCIS is not configured yet, because office.offid has to
        # be read from it before this machine can be tied to a facility.
        try:
            self.config_from_form().validate_jhcis()
        except ValueError as error:
            self.logger.info("enrollment_waiting_for_jhcis reason=%s", error)
            self.set_status(f"ได้รับลิงก์ลงทะเบียนแล้ว — กรอกข้อมูล JHCIS ให้ครบก่อน ({error})", "busy")
            return

        self.set_status("ได้รับลิงก์ลงทะเบียน กำลังลงทะเบียนอัตโนมัติ…", "busy")
        self.enroll_action()

    def enroll_action(self) -> None:
        link = self.pending_enrollment
        if link is None:
            self.logger.info("enroll_requested_without_link")
            self.set_status("ยังไม่มีลิงก์ลงทะเบียน กรุณาเปิดลิงก์จากหน้าเว็บบนเครื่องนี้", "error")
            return
        self.logger.info("enroll_started facility=%s", link.facility_code)

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

    def _entry(self, parent, row: int, key: str, label: str, value: str, secret: bool = False, hint: str = "") -> None:
        """One labelled field. Label above the box, so long Thai labels do not
        squeeze the input on a narrow window."""
        holder = ctk.CTkFrame(parent, fg_color="transparent")
        holder.grid(row=row, column=0, sticky="ew", pady=(0, 10))
        holder.columnconfigure(0, weight=1)

        ctk.CTkLabel(
            holder, text=label, anchor="w", text_color=MUTED, font=("Segoe UI Semibold", 11)
        ).grid(row=0, column=0, sticky="w")

        entry = ctk.CTkEntry(
            holder,
            height=36,
            corner_radius=8,
            border_width=1,
            border_color=LINE,
            fg_color="#ffffff",
            text_color=INK,
            show="•" if secret else "",
        )
        entry.grid(row=1, column=0, sticky="ew", pady=(3, 0))
        entry.insert(0, value)
        self._enable_clipboard(entry)
        self.entries[key] = entry

        if hint:
            ctk.CTkLabel(holder, text=hint, anchor="w", text_color=MUTED, font=("Segoe UI", 10)).grid(
                row=2, column=0, sticky="w", pady=(2, 0)
            )

    def _card(self, parent, title: str, subtitle: str = ""):
        card = ctk.CTkFrame(parent, corner_radius=10, fg_color="#ffffff", border_width=1, border_color=LINE)
        card.pack(fill="x", pady=(0, 12))
        card.columnconfigure(0, weight=1)

        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="both", expand=True, padx=16, pady=14)
        inner.columnconfigure(0, weight=1)

        ctk.CTkLabel(inner, text=title, anchor="w", text_color=INK, font=("Segoe UI Semibold", 14)).grid(
            row=0, column=0, sticky="w"
        )
        if subtitle:
            ctk.CTkLabel(
                inner, text=subtitle, anchor="w", justify="left", text_color=MUTED,
                font=("Segoe UI", 11), wraplength=560,
            ).grid(row=1, column=0, sticky="w", pady=(2, 10))
        else:
            ctk.CTkLabel(inner, text="", height=4).grid(row=1, column=0)
        return inner

    def _stat(self, parent, column: int, label: str, value: str):
        tile = ctk.CTkFrame(parent, corner_radius=10, fg_color=PAPER)
        tile.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 8, 0))
        tile.columnconfigure(0, weight=1)
        ctk.CTkLabel(tile, text=label, text_color=MUTED, font=("Segoe UI", 10), anchor="w").grid(
            row=0, column=0, sticky="w", padx=12, pady=(10, 0)
        )
        widget = ctk.CTkLabel(tile, text=value, text_color=INK, font=("Segoe UI Semibold", 15), anchor="w")
        widget.grid(row=1, column=0, sticky="w", padx=12, pady=(0, 10))
        return widget

    def _button(self, parent, text: str, command, primary: bool = False):
        return ctk.CTkButton(
            parent,
            text=text,
            command=command,
            height=36,
            corner_radius=8,
            font=("Segoe UI Semibold", 12),
            fg_color=ORANGE if primary else "#ffffff",
            hover_color=ORANGE_DARK if primary else PAPER,
            text_color="#ffffff" if primary else INK,
            border_width=0 if primary else 1,
            border_color=LINE,
        )

    def _enable_clipboard(self, entry) -> None:
        menu = tk.Menu(entry, tearoff=False)
        menu.add_command(label="ตัด", command=lambda: entry.event_generate("<<Cut>>"))
        menu.add_command(label="คัดลอก", command=lambda: entry.event_generate("<<Copy>>"))
        menu.add_command(label="วาง", command=lambda: entry.event_generate("<<Paste>>"))

        def popup(event) -> str:
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
            if widget is not None and hasattr(widget, "delete"):
                widget.delete(0, tk.END)
                widget.insert(0, value)
        self._refresh_dashboard()

    def open_settings(self) -> None:
        if self.settings_window is not None and self.settings_window.winfo_exists():
            self.settings_window.deiconify()
            self.settings_window.lift()
            self.settings_window.focus_force()
            return

        window = ctk.CTkToplevel(self.root)
        self.settings_window = window
        window.title(f"{APP_NAME} v{VERSION}")
        window.geometry("640x720")
        window.minsize(600, 620)
        window.configure(fg_color=PAPER)
        window.protocol("WM_DELETE_WINDOW", window.withdraw)

        shell = ctk.CTkScrollableFrame(window, fg_color=PAPER, corner_radius=0)
        shell.pack(fill="both", expand=True, padx=18, pady=16)

        header = ctk.CTkFrame(shell, fg_color="transparent")
        header.pack(fill="x", pady=(0, 14))
        badge = ctk.CTkLabel(
            header, text="TM", width=38, height=38, corner_radius=8,
            fg_color=ORANGE, text_color="#ffffff", font=("Segoe UI Black", 13),
        )
        badge.pack(side="left")
        titles = ctk.CTkFrame(header, fg_color="transparent")
        titles.pack(side="left", padx=12)
        ctk.CTkLabel(titles, text="TMT Drug Master Agent", anchor="w", text_color=INK,
                     font=("Segoe UI Black", 17)).pack(anchor="w")
        ctk.CTkLabel(titles, text=f"เวอร์ชัน {VERSION}", anchor="w", text_color=MUTED,
                     font=("Segoe UI", 11)).pack(anchor="w")

        # ------------------------------------------------------------ status
        status_card = self._card(shell, "สถานะการทำงาน")
        self.settings_status = ctk.CTkLabel(
            status_card, text=self.status_text, anchor="w", justify="left",
            text_color=STATE_COLORS[self.status_state], font=("Segoe UI Semibold", 12), wraplength=540,
        )
        self.settings_status.grid(row=2, column=0, sticky="w")

        stats = ctk.CTkFrame(status_card, fg_color="transparent")
        stats.grid(row=3, column=0, sticky="ew", pady=(12, 0))
        for column in range(3):
            stats.columnconfigure(column, weight=1)
        self.stat_facility = self._stat(stats, 0, "สถานบริการ", self.config.facility_code or "—")
        self.stat_machine = self._stat(stats, 1, "ชื่อเครื่อง", self.config.machine_label or socket.gethostname())
        self.stat_sync = self._stat(stats, 2, "ดึงล่าสุด", self.last_sync_text)

        # -------------------------------------------------------------- JHCIS
        jhcis = self._card(
            shell,
            "ฐานข้อมูล JHCIS ในวง LAN นี้",
            "กรอกเฉพาะส่วนนี้ รหัสผ่านถูกเก็บด้วย Windows DPAPI บนเครื่องนี้เท่านั้น ไม่ถูกส่งขึ้นระบบกลาง",
        )
        self.entries = {}
        pair = ctk.CTkFrame(jhcis, fg_color="transparent")
        pair.grid(row=2, column=0, sticky="ew")
        pair.columnconfigure(0, weight=3)
        pair.columnconfigure(1, weight=1)
        host_holder = ctk.CTkFrame(pair, fg_color="transparent")
        host_holder.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        host_holder.columnconfigure(0, weight=1)
        port_holder = ctk.CTkFrame(pair, fg_color="transparent")
        port_holder.grid(row=0, column=1, sticky="ew")
        port_holder.columnconfigure(0, weight=1)
        self._entry(host_holder, 0, "jhcis_host", "Host / IP", self.config.jhcis_host)
        self._entry(port_holder, 0, "jhcis_port", "Port", str(self.config.jhcis_port))

        self._entry(jhcis, 3, "jhcis_database", "ชื่อฐานข้อมูล", self.config.jhcis_database)
        self._entry(jhcis, 4, "jhcis_user", "ผู้ใช้ฐานข้อมูล", self.config.jhcis_user)
        self._entry(jhcis, 5, "jhcis_password", "รหัสผ่านฐานข้อมูล", self.config.jhcis_password, True)

        test_row = ctk.CTkFrame(jhcis, fg_color="transparent")
        test_row.grid(row=6, column=0, sticky="w")
        self._button(test_row, "ทดสอบการเชื่อมต่อ JHCIS", self.test_connection).pack(side="left")

        # ------------------------------------------------------------- server
        server = self._card(
            shell,
            "การเชื่อมต่อระบบกลาง",
            "ปกติไม่ต้องแก้ การลงทะเบียนทำได้จากหน้าเว็บ เมนู “เชื่อมต่อ JHCIS” แล้วกดสร้างลิงก์ลงทะเบียน",
        )
        self._entry(server, 2, "server_url", "Server URL", self.config.server_url)
        self._entry(
            server, 3, "machine_label", "ชื่อเครื่อง",
            self.config.machine_label or socket.gethostname(),
            hint="เว้นว่างไว้ ระบบจะใช้ชื่อเครื่องจริงของ Windows",
        )
        ctk.CTkLabel(
            server, text=f"Installation ID: {self.config.installation_id}", anchor="w",
            text_color=MUTED, font=("Consolas", 10),
        ).grid(row=4, column=0, sticky="w", pady=(2, 10))

        server_row = ctk.CTkFrame(server, fg_color="transparent")
        server_row.grid(row=5, column=0, sticky="w")
        self._button(server_row, "ลงทะเบียนด้วยลิงก์ที่คัดลอกมา", self.enroll_action).pack(side="left")

        # ------------------------------------------------------------ actions
        actions = ctk.CTkFrame(shell, fg_color="transparent")
        actions.pack(fill="x", pady=(2, 0))
        self._button(actions, "บันทึกและย่อไป Tray", self.save_and_hide, primary=True).pack(side="right")
        self._button(actions, "ดึงรายการยาตอนนี้", self.sync_now).pack(side="right", padx=(0, 8))
        self._button(actions, "เปิด log", self.open_log).pack(side="left")

        self._refresh_dashboard()

    def _refresh_dashboard(self) -> None:
        """Keeps the three tiles in step with the config the worker is using."""
        if self.settings_window is None or not self.settings_window.winfo_exists():
            return
        if getattr(self, "stat_facility", None) is not None:
            self.stat_facility.configure(text=self.config.facility_code or "—")
            self.stat_machine.configure(text=self.config.machine_label or socket.gethostname())
            self.stat_sync.configure(text=self.last_sync_text)

    def config_from_form(self) -> AgentConfig:
        if not self.entries:
            return self.config
        def text(key: str) -> str:
            return self.entries[key].get()

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
            if self.pending_enrollment is not None:
                self.set_status("บันทึกแล้ว กำลังลงทะเบียนต่อ…", "busy")
                self.enroll_action()
                return
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
        self.logger.info(
            "agent_started version=%s enrolled=%s poll_interval=%ss auto_sync=%s",
            VERSION,
            self.config.enrolled,
            self.config.poll_interval_seconds,
            self.config.auto_sync_enabled,
        )
        self.icon.run_detached()
        self.ipc.start()
        self.worker.start()
        if self.pending_link:
            self.root.after(200, lambda: self.handle_enrollment_link(str(self.pending_link)))
        elif not self.config.enrolled:
            self.root.after(250, self.open_settings)
        self.root.mainloop()


def selftest() -> int:
    """
    Drives a JHCIS connection that is meant to fail, inside this binary.

    A PyInstaller build can be missing a module the driver imports by name,
    and nothing reveals that until the driver takes that path. Here the
    connection is aimed at a closed port so the failure runs through
    mysql-connector's error construction, which is where the missing
    `mysql.connector.locales.eng.client_error` used to turn every JHCIS error
    into an ImportError and hide the real cause.

    Passes when the failure comes back as a mapped JhcisFailure.
    """
    from tmt_agent.config import AgentConfig, app_data_dir
    from tmt_agent.errors import JhcisFailure

    def report(text: str, code: int) -> int:
        # A --windowed build has no console, so printing proves nothing. The
        # result goes to a file the caller can read and assert on.
        print(text)
        try:
            (app_data_dir() / "selftest.txt").write_text(text, encoding="utf-8")
        except OSError:
            pass
        return code

    probe = AgentConfig(
        installation_id="00000000-0000-4000-8000-000000000000",
        jhcis_host="127.0.0.1",
        jhcis_port=1,  # nothing listens here
        jhcis_database="selftest",
        jhcis_user="selftest",
        jhcis_password="selftest",
    )
    try:
        read_office(probe)
    except JhcisFailure as failure:
        # A closed port must read as a host problem. JHCIS_DRIVER_INCOMPLETE
        # here means this binary is missing a module the driver loads by name,
        # which is precisely what this check exists to catch.
        if failure.code == "JHCIS_HOST":
            return report(f"selftest OK: closed port reported as {failure.code}", 0)
        return report(f"selftest FAILED: expected JHCIS_HOST, got {failure.code} - {failure}", 1)
    except Exception as error:  # noqa: BLE001 - the point is to catch anything else
        return report(f"selftest FAILED: {type(error).__name__}: {error}", 1)
    return report("selftest FAILED: a connection to a closed port succeeded", 1)


def main() -> int:
    if "--version" in sys.argv:
        print(VERSION)
        return 0
    if "--register-protocol" in sys.argv:
        register_protocol_handler(sys.executable)
        return 0
    if "--selftest" in sys.argv:
        return selftest()

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
