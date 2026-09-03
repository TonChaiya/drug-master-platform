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
    if error.errno == 1130:
        return JhcisFailure(
            "JHCIS_HOST_DENIED",
            "JHCIS ไม่อนุญาตให้เครื่องนี้เชื่อมต่อ ต้องเปิดสิทธิ์ผู้ใช้ฐานข้อมูลให้เครื่องในวง LAN",
        )
    if error.errno in {2003, 2005}:
        return JhcisFailure("JHCIS_HOST", "ติดต่อ JHCIS host/port ไม่สำเร็จ")
    if error.errno in {1049, 1146}:
        return JhcisFailure("JHCIS_SCHEMA", "ไม่พบฐานหรือตาราง JHCIS ที่กำหนด")
    # Everything else carries the driver's own code and text. A bare
    # "database error" sent an operator hunting the wrong thing for an hour when
    # the real answer was already in the exception.
    return JhcisFailure("JHCIS_DATABASE", f"JHCIS ตอบกลับด้วย database error [{error.errno}] {error}")


def _driver_incomplete() -> JhcisFailure:
    """
    The MySQL driver imports its error-message locales and auth plugins by name
    at runtime, so a packaged build can be missing one. It surfaces only while
    connecting, and once did so as "No localization support for language 'eng'"
    raised from inside the driver's own error construction — which replaced
    every real JHCIS error with an ImportError.

    It gets its own code rather than being folded into JHCIS_CONNECTION: this is
    a broken installation, not an unreachable database, and the build's
    self-test has to be able to tell them apart.
    """
    return JhcisFailure(
        "JHCIS_DRIVER_INCOMPLETE",
        "ตัวโปรแกรมติดตั้งไม่สมบูรณ์ (ขาดโมดูลของไดรเวอร์ MySQL) กรุณาติดตั้ง Agent เวอร์ชันใหม่",
    )


# utf8mb4 arrived in MySQL 5.5.3. JHCIS servers in the field are frequently
# older than that and answer "Unknown character set: 'utf8mb4'" (errno 1115),
# which is what stopped this agent connecting to a real รพ.สต. database while
# the developer's own MySQL worked. Thai sits entirely in the BMP, so three-byte
# utf8 loses nothing here; utf8mb4 is still tried first for newer servers.
CHARSETS = ("utf8mb4", "utf8")
UNKNOWN_CHARSET = 1115


def _connect(config: AgentConfig):
    config.validate_jhcis()
    last_error: MySqlError | None = None
    for charset in CHARSETS:
        try:
            return mysql.connector.connect(
                host=config.jhcis_host,
                port=config.jhcis_port,
                database=config.jhcis_database,
                user=config.jhcis_user,
                password=config.jhcis_password,
                connection_timeout=8,
                autocommit=False,
                use_pure=True,
                charset=charset,
            )
        except MySqlError as error:
            if error.errno != UNKNOWN_CHARSET:
                raise
            last_error = error
    raise last_error if last_error else RuntimeError("no charset attempted")


SYNTAX_ERROR = 1064


def _begin_read_only(cursor) -> None:
    """
    Opens the snapshot transaction the read runs in.

    READ ONLY arrived in MySQL 5.6 and JHCIS in the field runs 5.1, which
    rejects it as a syntax error — that is what stopped this agent on a real
    รพ.สต. server. Where the server understands it the guarantee is kept; where
    it does not, the transaction is still only ever fed SELECTs and is always
    rolled back, so JHCIS is never written to either way.
    """
    try:
        cursor.execute("START TRANSACTION READ ONLY")
    except MySqlError as error:
        if error.errno != SYNTAX_ERROR:
            raise
        cursor.execute("START TRANSACTION")


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
            _begin_read_only(cursor)
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
    except ImportError:
        raise _driver_incomplete() from None
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
            _begin_read_only(cursor)
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
    except ImportError:
        raise _driver_incomplete() from None
    except (OSError, ValueError):
        raise JhcisFailure("JHCIS_CONNECTION", "เชื่อมต่อ JHCIS ไม่สำเร็จ") from None
    finally:
        if connection is not None and connection.is_connected():
            connection.close()
