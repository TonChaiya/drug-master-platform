from __future__ import annotations

import re
from dataclasses import dataclass

import mysql.connector
from mysql.connector import Error as MySqlError

from poc_agent.config import AgentConfig

OFFICE_PATTERN = re.compile(r"^\d{5}$")
COUNT_SQL = """
SELECT COUNT(*)
FROM cdrug
WHERE drugflag = '1'
  AND drugtype IN ('01', '10')
"""


@dataclass(frozen=True)
class JhcisResult:
    office_id: str
    eligible_drug_count: int


class JhcisConnectionError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _mysql_error(error: MySqlError) -> JhcisConnectionError:
    if error.errno in {1044, 1045, 1698}:
        return JhcisConnectionError("JHCIS_AUTH", "JHCIS ปฏิเสธชื่อผู้ใช้หรือรหัสผ่าน")
    if error.errno in {2003, 2005}:
        return JhcisConnectionError("JHCIS_HOST", "ติดต่อ JHCIS host/port ไม่สำเร็จ")
    if error.errno in {1049, 1146}:
        return JhcisConnectionError("JHCIS_SCHEMA", "ไม่พบฐานหรือตาราง JHCIS ที่กำหนด")
    return JhcisConnectionError("JHCIS_DATABASE", "JHCIS ตอบกลับด้วย database error")


def test_jhcis(config: AgentConfig) -> JhcisResult:
    config.validate_jhcis()
    connection = None
    try:
        connection = mysql.connector.connect(
            host=config.jhcis_host,
            port=config.jhcis_port,
            database=config.jhcis_database,
            user=config.jhcis_user,
            password=config.jhcis_password,
            connection_timeout=8,
            autocommit=False,
            use_pure=True,
        )
        cursor = connection.cursor()
        try:
            cursor.execute("START TRANSACTION READ ONLY")
            cursor.execute("SELECT offid FROM office")
            office_ids = sorted({str(row[0]).strip() for row in cursor.fetchall() if row and row[0] is not None})
            valid = [value for value in office_ids if OFFICE_PATTERN.fullmatch(value) and not value.startswith("0000")]
            if len(valid) != 1:
                raise JhcisConnectionError("JHCIS_OFFICE_INVALID", "ต้องพบ office.offid ที่ถูกต้องเพียงรหัสเดียว")
            office_id = valid[0]
            if config.allowed_office_id and office_id != config.allowed_office_id:
                raise JhcisConnectionError("JHCIS_OFFICE_MISMATCH", "office.offid ไม่ตรงกับสถานบริการที่อนุญาต")
            cursor.execute(COUNT_SQL)
            row = cursor.fetchone()
            if row is None:
                raise JhcisConnectionError("JHCIS_COUNT_EMPTY", "JHCIS ไม่ส่งผลจำนวนยา")
            count = int(row[0])
            if count < 0:
                raise JhcisConnectionError("JHCIS_COUNT_INVALID", "จำนวนยา JHCIS ไม่ถูกต้อง")
            return JhcisResult(office_id=office_id, eligible_drug_count=count)
        finally:
            connection.rollback()
            cursor.close()
    except JhcisConnectionError:
        raise
    except MySqlError as error:
        raise _mysql_error(error) from None
    except (OSError, ValueError):
        raise JhcisConnectionError("JHCIS_CONNECTION", "เชื่อมต่อ JHCIS ไม่สำเร็จ") from None
    finally:
        if connection is not None and connection.is_connected():
            connection.close()
