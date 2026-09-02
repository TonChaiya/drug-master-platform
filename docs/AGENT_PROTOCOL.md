# Windows Agent Protocol

Agent เป็นทางเดียวที่รองรับสำหรับดึง JHCIS จากวง LAN เมื่อเว็บอยู่บน cloud โดยเปิดเฉพาะ outbound HTTPS ไม่เปิด MySQL port ออกอินเทอร์เน็ต

## ประสบการณ์ผู้ใช้

1. ผู้ใช้ login และเปิดหน้า “เชื่อมต่อ JHCIS”
2. ดาวน์โหลด Setup จาก GitHub Releases
3. ติดตั้งครั้งเดียว; installer หยุด process/service เก่า ถอนเวอร์ชันเดิมที่ product code เดียวกัน ล้าง shortcut เก่า แล้วลงเวอร์ชันใหม่
4. เว็บสร้าง enrollment link อายุ 10 นาทีและเปิด `tmtagent://enroll?...`
5. Agent แสดง IP JHCIS ช่องเดียวก่อน ค่าเริ่มต้น port 3333, database `jhcisdb`, user `root`; advanced settings แก้ได้
6. Agent ทดสอบฐาน อ่าน `office.offid` และเชื่อมได้ต่อเมื่อรหัสตรงกับบัญชี/สถานบริการที่ออก token
7. icon tray แสดง connected/waiting/error และเปิด Settings/Reconnect/Logs/Quit ได้ตลอด

รหัสฐาน JHCIS ต้องกรอก/เก็บใน Agent เท่านั้น ป้องกันด้วย Windows DPAPI และไม่ส่งขึ้น server

## Reconnect และย้ายสถานบริการ

- Settings ต้องเปิดได้เสมอแม้เคย enrollment แล้ว
- Agent มี stable `installationId` แบบ UUID ต่อการติดตั้ง
- เมื่อเปิด enrollment link ใหม่ ตัว tray ที่รันอยู่ต้อง reload config ทันที (single-instance IPC หรือ config change signal) ไม่ให้ process ที่สองเขียนค่าแล้วตัวแรกใช้ค่าเก่า
- ออก credential ใหม่ก่อน จากนั้น Agent ยืนยันว่าบันทึกสำเร็จจึง revoke credential เดิมของ installation เดียวกัน
- ห้าม revoke Agent เครื่องอื่นใน facility เดียวกัน
- เปลี่ยน facility ต้องตรวจ `office.offid` ใหม่และไม่รับคำสั่งก่อนการจับคู่สำเร็จ

## JHCIS query contract

```sql
SELECT drugcode, drugname, drugnamethai, druggenericname,
       drugtype, pack, unitsell, unitusage, cost, sell,
       nationaccount, drugcode24
FROM cdrug
WHERE drugflag = '1'
  AND drugtype IN ('01', '10')
ORDER BY drugcode;
```

ก่อน query ยาต้องอ่าน `office.offid` ที่เป็นรหัส 5 หลักและไม่ใช่ `0000x`; ต้องได้สถานบริการเดียวที่แน่นอน มิฉะนั้นหยุด sync

## API endpoints (v1 proposal)

- `POST /api/v1/agent/enroll`
- `POST /api/v1/agent/commands/poll`
- `POST /api/v1/agent/sync/begin`
- `POST /api/v1/agent/sync/batch`
- `POST /api/v1/agent/sync/finish`
- `POST /api/v1/agent/commands/{id}/complete`

Payload JSON จำกัดเป้าหมายไม่เกิน 1 MiB; เริ่ม batch 300 แถวและลดอัตโนมัติเมื่อเกิน limit

## Authentication

ทุก request หลัง enrollment ส่ง:

- `X-Agent-Key`
- `X-Agent-Timestamp`
- `X-Agent-Nonce`
- `X-Agent-Signature`
- `X-Agent-Protocol: 1`

canonical string:

```text
v1\n
POST\n
/api/v1/agent/sync/batch\n
<unix timestamp>\n
<nonce>\n
<sha256(body bytes)>
```

signature = HMAC-SHA256 ด้วย Agent secret

Server ต้อง:

- บังคับ HTTPS, constant-time compare, clock skew ไม่เกินค่ากำหนด และ nonce ใช้ครั้งเดียว
- ตรวจ credential active + installation + facility ทุก request
- ตรวจ `officeId` จาก Agent ตรงกับ facility ของ credential ทั้ง begin/batch/finish
- validate และจำกัดทุก field ก่อน staging
- commit เมื่อ finish สำเร็จเท่านั้น; retry ต้อง idempotent
- log เฉพาะ key id/error code ห้าม log secret/password/body ทั้งก้อน

## Polling and commands

- ค่าเริ่มต้น poll 15–30 วินาที พร้อม exponential backoff + jitter เมื่อ error
- server claim command แบบ atomic ป้องกันหลาย process รับงานเดียว
- command มี expiry และ idempotency key
- command ขั้นต่ำ: `sync_now`, `test_connection`, `refresh_config`, `upgrade_notice`
- auto sync เป็น policy ที่ Agent ทำได้เอง ไม่พึ่ง cloud cron ความถี่สูง

## Packaging gates

- source version, UI version, installer version และ API report ต้องมาจากไฟล์เดียว
- installer upgrade test ต้องยืนยันว่าไม่มี process, shortcut, uninstall entry หรือ config ผิดชุดเหลืออยู่
- config ของผู้ใช้เก็บไว้เฉพาะเมื่อ upgrade; full uninstall ให้เลือกเก็บ/ลบอย่างชัดเจน
- ทดสอบ Windows 10/11, non-admin user หลังติดตั้ง, Thai path/machine name และ MySQL authentication ของ JHCIS จริง

