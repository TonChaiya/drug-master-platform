from __future__ import annotations

import logging
import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from tmt_agent.api import AgentApi
from tmt_agent.config import AgentConfig, ConfigStore
from tmt_agent.errors import AgentFailure, JhcisFailure, ServerFailure
from tmt_agent.jhcis import read_drugs, read_office

logger = logging.getLogger("tmt-agent")


@dataclass(frozen=True)
class SyncOutcome:
    received: int
    inserted: int
    updated: int
    deactivated: int


def run_sync(config: AgentConfig, agent_version: str, on_progress: Callable[[str], None] | None = None) -> SyncOutcome:
    """
    Streams JHCIS rows to the server in batches. Nothing is applied centrally
    until finish() succeeds, so a failure part-way leaves the previous snapshot
    intact.
    """
    api = AgentApi(config)
    session_id: str | None = None
    batch_size = 300
    sent = 0
    office_id: str | None = None

    for current_office, total, batch in read_drugs(config, batch_size):
        if office_id is None:
            office_id = current_office
            if config.facility_code and office_id != config.facility_code:
                raise JhcisFailure("JHCIS_OFFICE_MISMATCH", "office.offid ไม่ตรงกับสถานบริการที่ลงทะเบียนไว้")
            session_id, batch_size = api.sync_begin(office_id, total, agent_version)
        elif current_office != office_id:
            raise JhcisFailure("JHCIS_OFFICE_CHANGED", "office.offid เปลี่ยนระหว่างการดึงข้อมูล")

        assert session_id is not None
        api.sync_batch(session_id, office_id, batch)
        sent += len(batch)
        if on_progress:
            on_progress(f"ส่งแล้ว {sent:,}/{total:,} รายการ")

    if office_id is None or session_id is None:
        # No rows at all: still open and close a session so the server records
        # an empty snapshot rather than keeping stale drugs active.
        snapshot = read_office(config)
        office_id = snapshot.office_id
        if config.facility_code and office_id != config.facility_code:
            raise JhcisFailure("JHCIS_OFFICE_MISMATCH", "office.offid ไม่ตรงกับสถานบริการที่ลงทะเบียนไว้")
        session_id, _ = api.sync_begin(office_id, 0, agent_version)

    result = api.sync_finish(session_id, office_id)
    return SyncOutcome(
        received=int(result.get("received") or 0),
        inserted=int(result.get("inserted") or 0),
        updated=int(result.get("updated") or 0),
        deactivated=int(result.get("deactivated") or 0),
    )


class CommandWorker:
    """
    Background loop: polls for commands, executes them, reports the result, and
    reloads config from disk when another process (the tmtagent:// handler)
    rewrites it — the reconnect bug called out in AGENTS.md.
    """

    def __init__(
        self,
        store: ConfigStore,
        agent_version: str,
        on_status: Callable[[str, str], None],
        on_config_reloaded: Callable[[AgentConfig], None],
    ) -> None:
        self.store = store
        self.agent_version = agent_version
        self.on_status = on_status
        self.on_config_reloaded = on_config_reloaded
        self.stop_event = threading.Event()
        self.wake_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._config = store.load()
        self._config_mtime = store.mtime()
        self._backoff = 0
        self._last_auto_sync = 0.0
        self._announced_unenrolled = False

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="tmt-agent-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.wake_event.set()

    def wake(self) -> None:
        self.wake_event.set()

    @property
    def config(self) -> AgentConfig:
        return self._config

    def replace_config(self, config: AgentConfig) -> None:
        self._config = config
        self._config_mtime = self.store.mtime()

    def _reload_if_changed(self) -> None:
        mtime = self.store.mtime()
        if mtime and mtime != self._config_mtime:
            try:
                self._config = self.store.load()
                self._config_mtime = mtime
                self._backoff = 0
                self.on_config_reloaded(self._config)
                logger.info("config_reloaded")
            except (OSError, ValueError, KeyError, TypeError):
                logger.warning("config_reload_failed")

    def _sleep(self, seconds: float) -> None:
        self.wake_event.wait(timeout=seconds)
        self.wake_event.clear()

    def _handle(self, api: AgentApi, command: dict[str, object]) -> None:
        command_id = str(command.get("id") or "")
        claim_token = str(command.get("claimToken") or "")
        command_type = str(command.get("commandType") or "")
        if not command_id or not claim_token:
            return

        try:
            if command_type == "sync_now":
                outcome = run_sync(self._config, self.agent_version, lambda text: self.on_status(text, "busy"))
                logger.info(
                    "sync_now_ok received=%s inserted=%s updated=%s deactivated=%s",
                    outcome.received, outcome.inserted, outcome.updated, outcome.deactivated,
                )
                message = f"ส่ง {outcome.received:,} รายการ (เพิ่ม {outcome.inserted:,} แก้ไข {outcome.updated:,} ปิดใช้ {outcome.deactivated:,})"
                self.on_status(message, "ok")
                api.complete_command(command_id, claim_token, True, "OK", message)
                self._last_auto_sync = time.monotonic()
            elif command_type == "test_connection":
                snapshot = read_office(self._config)
                message = f"JHCIS พร้อม office {snapshot.office_id} · ยา 01/10 {snapshot.eligible_drug_count:,} รายการ"
                self.on_status(message, "ok")
                api.complete_command(command_id, claim_token, True, "OK", message)
            elif command_type == "refresh_config":
                self._reload_if_changed()
                api.complete_command(command_id, claim_token, True, "OK", "อ่านการตั้งค่าใหม่แล้ว")
            elif command_type == "upgrade_notice":
                self.on_status("มีเวอร์ชันใหม่ของ Agent", "busy")
                api.complete_command(command_id, claim_token, True, "OK", f"เวอร์ชันปัจจุบัน {self.agent_version}")
            else:
                api.complete_command(command_id, claim_token, False, "UNSUPPORTED", "คำสั่งนี้ไม่รองรับในเวอร์ชันนี้")
        except AgentFailure as failure:
            logger.warning("command_failed type=%s code=%s", command_type, failure.code)
            self.on_status(str(failure), "error")
            try:
                api.complete_command(command_id, claim_token, False, failure.code, str(failure))
            except AgentFailure:
                logger.warning("command_report_failed type=%s", command_type)

    def _maybe_auto_sync(self, api: AgentApi) -> None:
        if not self._config.auto_sync_enabled:
            return
        interval = self._config.auto_sync_interval_minutes * 60
        if self._last_auto_sync and time.monotonic() - self._last_auto_sync < interval:
            return
        logger.info("auto_sync_started interval=%smin", self._config.auto_sync_interval_minutes)
        try:
            outcome = run_sync(self._config, self.agent_version, lambda text: self.on_status(text, "busy"))
            self._last_auto_sync = time.monotonic()
            logger.info(
                "auto_sync_ok received=%s inserted=%s updated=%s deactivated=%s",
                outcome.received, outcome.inserted, outcome.updated, outcome.deactivated,
            )
            self.on_status(f"auto sync สำเร็จ {outcome.received:,} รายการ", "ok")
        except AgentFailure as failure:
            self._last_auto_sync = time.monotonic()
            logger.warning("auto_sync_failed code=%s", failure.code)
            self.on_status(str(failure), "error")

    def _loop(self) -> None:
        while not self.stop_event.is_set():
            self._reload_if_changed()
            if not self._config.enrolled:
                if not self._announced_unenrolled:
                    logger.info("waiting_for_enrollment: open the link from the JHCIS page on this machine")
                    self._announced_unenrolled = True
                self._sleep(10)
                continue
            self._announced_unenrolled = False

            api = AgentApi(self._config)
            try:
                snapshot = read_office(self._config)
                command = api.poll_command(snapshot.office_id, self.agent_version, True)
                self._backoff = 0
                if command:
                    logger.info("command_received type=%s", command.get("commandType"))
                    self._handle(api, command)
                else:
                    self._maybe_auto_sync(api)
            except ServerFailure as failure:
                self._backoff = min(self._backoff + 1, 6)
                logger.warning("poll_failed code=%s", failure.code)
                self.on_status(str(failure), "error")
            except JhcisFailure as failure:
                logger.warning("jhcis_failed code=%s", failure.code)
                self.on_status(str(failure), "error")
                try:
                    api.poll_command(None, self.agent_version, False)
                    self._backoff = 0
                except ServerFailure:
                    self._backoff = min(self._backoff + 1, 6)
                    logger.warning("heartbeat_failed_while_jhcis_unreachable")

            # exponential backoff with jitter, per docs/OPERATIONS.md
            base = self._config.poll_interval_seconds
            delay = base * (2**self._backoff) if self._backoff else base
            self._sleep(min(delay, 600) + random.uniform(0, base / 2))
