from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterator

import mysql.connector
from mysql.connector import Error as MySqlError

from tmt_agent.config import AgentConfig, is_valid_office_id
from tmt_agent.errors import JhcisFailure

# Fixed by docs/AGENT_PROTOCOL.md. drugtype 05 is deliberately excluded.
DRUG_SQL = """
SELECT drugcode, drugname, drugnamethai, druggenericname,
       drugtype, pack, unitsell, unitusage, cost, sell,
       nationaccount, drugcode24
FROM cdrug
WHERE drugflag = '1'
  AND drugtype IN ('01', '10')
ORDER BY drugcode
"""

COUNT_SQL = "SELECT COUNT(*) FROM cdrug WHERE drugflag = '1' AND drugtype IN ('01', '10')"

FIELDS = (
    "drugcode",
    "drugname",
    "drugnamethai",
    "druggenericname",
    "drugtype",
    "pack",
    "unitsell",
    "unitusage",
    "cost",
    "sell",
    "nationaccount",
    "drugcode24",
)

TEXT_LIMITS = {
    "drugcode": 64,
    "drugname": 255,
    "drugnamethai": 255,
    "druggenericname": 255,
    "pack": 120,
    "unitsell": 120,
    "unitusage": 120,
    "nationaccount": 32,
    "drugcode24": 32,
}


@dataclass(frozen=True)
class JhcisSnapshot:
    office_id: str
    eligible_drug_count: int


def _mysql_error(error: MySqlError) -> JhcisFailure:
    if error.errno in {1044, 1045, 1698}:
        return JhcisFailure("JHCIS_AUTH", "JHCIS ปฏิเสธชื่อผู้ใช้หรือรหัสผ่าน")
    if error.errno in {2003, 2005}:
        return JhcisFailure("JHCIS_HOST", "ติดต่อ JHCIS host/port ไม่สำเร็จ")
    if error.errno in {1049, 1146}:
        return JhcisFailure("JHCIS_SCHEMA", "ไม่พบฐานหรือตาราง JHCIS ที่กำหนด")
    return JhcisFailure("JHCIS_DATABASE", "JHCIS ตอบกลับด้วย database error")


def _connect(config: AgentConfig):
    config.validate_jhcis()
    return mysql.connector.connect(
        host=config.jhcis_host,
        port=config.jhcis_port,
        database=config.jhcis_database,
        user=config.jhcis_user,
        password=config.jhcis_password,
        connection_timeout=8,
        autocommit=False,
        use_pure=True,
        charset="utf8mb4",
    )


def _read_office_id(cursor) -> str:
    cursor.execute("SELECT offid FROM office")
    values = sorted({str(row[0]).strip() for row in cursor.fetchall() if row and row[0] is not None})
    valid = [value for value in values if is_valid_office_id(value)]
    if len(valid) != 1:
        raise JhcisFailure("JHCIS_OFFICE_INVALID", "ต้องพบ office.offid ที่ถูกต้องเพียงรหัสเดียว")
    return valid[0]


def _normalize(row: tuple[Any, ...]) -> dict[str, Any]:
    record: dict[str, Any] = {}
    for name, value in zip(FIELDS, row, strict=True):
        if value is None:
            record[name] = None
            continue
        if name in {"cost", "sell"}:
            record[name] = str(value) if isinstance(value, Decimal) else (None if value == "" else str(value))
            continue
        text = str(value).strip()
        limit = TEXT_LIMITS.get(name)
        record[name] = (text[:limit] if limit else text) or (None if name != "drugcode" else text)
    return record


def read_office(config: AgentConfig) -> JhcisSnapshot:
    """Reads office.offid and the eligible drug count without transferring rows."""
    connection = None
    try:
        connection = _connect(config)
        cursor = connection.cursor()
        try:
            cursor.execute("START TRANSACTION READ ONLY")
            office_id = _read_office_id(cursor)
            cursor.execute(COUNT_SQL)
            row = cursor.fetchone()
            if row is None:
                raise JhcisFailure("JHCIS_COUNT_EMPTY", "JHCIS ไม่ส่งผลจำนวนยา")
            return JhcisSnapshot(office_id=office_id, eligible_drug_count=int(row[0]))
        finally:
            connection.rollback()
            cursor.close()
    except JhcisFailure:
        raise
    except MySqlError as error:
        raise _mysql_error(error) from None
    except (OSError, ValueError):
        raise JhcisFailure("JHCIS_CONNECTION", "เชื่อมต่อ JHCIS ไม่สำเร็จ") from None
    finally:
        if connection is not None and connection.is_connected():
            connection.close()


def read_drugs(config: AgentConfig, batch_size: int = 300) -> Iterator[tuple[str, int, list[dict[str, Any]]]]:
    """
    Yields (office_id, total, batch). The office id is re-read inside the same
    read-only transaction that produces the rows, so a mid-sync database swap
    cannot slip rows from another facility through.
    """
    connection = None
    try:
        connection = _connect(config)
        cursor = connection.cursor()
        try:
            cursor.execute("START TRANSACTION READ ONLY")
            office_id = _read_office_id(cursor)
            cursor.execute(COUNT_SQL)
            count_row = cursor.fetchone()
            total = int(count_row[0]) if count_row else 0

            cursor.execute(DRUG_SQL)
            while True:
                rows = cursor.fetchmany(batch_size)
                if not rows:
                    break
                yield office_id, total, [_normalize(row) for row in rows]
        finally:
            connection.rollback()
            cursor.close()
    except JhcisFailure:
        raise
    except MySqlError as error:
        raise _mysql_error(error) from None
    except (OSError, ValueError):
        raise JhcisFailure("JHCIS_CONNECTION", "เชื่อมต่อ JHCIS ไม่สำเร็จ") from None
    finally:
        if connection is not None and connection.is_connected():
            connection.close()
