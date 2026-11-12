# การทำงานและการขึ้นระบบ (OPERATIONS)

เอกสารนี้อธิบายว่าระบบ **ทำงานอย่างไรและขึ้นระบบอย่างไร** ส่วน **ต้องทำอะไร** อยู่ใน [SPEC.md](SPEC.md)
สถานะ deployment และ checkpoint ปัจจุบันดู [PROJECT_STATUS.md](PROJECT_STATUS.md); ไฟล์นี้เป็น runbook ไม่ใช่ status diary

---

## 1. สถาปัตยกรรม

```text
Browser
  -> Next.js App Router (UI + Route Handlers)
       -> application services / authorization policy
            -> TiDB Cloud (ข้อมูลกลาง)
            -> TMT API (server-to-server)

Windows Tray Agent ที่สถานบริการ
  -> อ่าน JHCIS ใน LAN แบบ read-only
  -> outbound HTTPS + signed requests
  -> Next.js Agent API
```

### ขอบเขตของแต่ละชั้น

- React component ห้าม query DB โดยตรง ให้ผ่าน server-side service
- Route Handler ทำเพียง auth, validation, rate/size limit, เรียก use case และแปลง response
- ทุก query ที่เป็นข้อมูลสถานบริการต้องรับ facility scope ที่สร้างจาก session เท่านั้น (`lib/authorization/require-context.ts`)
- admin เลือก facility เป็น explicit context พร้อม audit ไม่แก้ session owner
- TMT API และ Excel parsing เป็น adapter แยกจาก business rules

### ข้อจำกัดของโฮสต์

- เว็บบน cloud เปิด connection เข้า LAN/JHCIS ไม่ได้อย่างปลอดภัย จึงใช้ Agent outbound เท่านั้น
- filesystem ของ function เป็น ephemeral ห้ามใช้เก็บ session, template, upload หรือ export ระยะยาว
- ออกแบบ Agent batch ให้ต่ำกว่าข้อจำกัด payload ของ provider (เป้าหมายไม่เกิน 1 MiB ต่อ request)
- cron ไม่ใช่ช่องสั่ง Agent หลัก Agent poll คำสั่งเป็นระยะเอง
- ตรวจเงื่อนไข plan ของผู้ให้บริการก่อน production โดยเฉพาะการใช้งานของหน่วยงาน

### สิ่งที่ยังไม่ทำในระยะนี้

- ไม่เชื่อม JHCIS โดยตรงจาก cloud
- ไม่ migrate ข้อมูลจริงจากฐานเก่า
- ไม่รองรับ PRODUCTCAT 2/4 จนมี concept TP/GP-F/GP-X ที่ยืนยันแล้ว

---

## 2. Windows Agent

Agent เป็นทางเดียวที่รองรับสำหรับดึง JHCIS จากวง LAN เปิดเฉพาะ outbound HTTPS ไม่เปิด MySQL port ออกอินเทอร์เน็ต
ซอร์สอยู่ที่ `agent/windows/` ไฟล์ติดตั้งเผยแพร่ผ่าน GitHub Releases ไม่เก็บใน repo

### ประสบการณ์ผู้ใช้

1. ผู้ใช้ login แล้วเปิดหน้า "เชื่อมต่อ JHCIS"
2. ดาวน์โหลด Setup จาก GitHub Releases แล้วติดตั้งบนเครื่องในวง LAN เดียวกับ JHCIS
3. เว็บสร้าง enrollment link อายุ 10 นาที ใช้ได้ครั้งเดียว และเปิด `tmtagent://enroll?...`
4. Agent กรอก IP JHCIS ช่องเดียวก่อน ค่าเริ่มต้น port 3333, database `jhcisdb`, user `root`
5. Agent ทดสอบฐาน อ่าน `office.offid` และเชื่อมได้ต่อเมื่อรหัสตรงกับสถานบริการที่ออก token
6. icon tray แสดง connected/waiting/error และเปิด Settings/Reconnect/Logs/Quit ได้ตลอด

รหัสฐาน JHCIS กรอกและเก็บใน Agent เท่านั้น ป้องกันด้วย Windows DPAPI **ไม่ส่งขึ้น server**

### Reconnect และย้ายสถานบริการ

- Settings ต้องเปิดได้เสมอแม้เคย enrollment แล้ว
- Agent มี `installationId` แบบ UUID ที่คงที่ระดับเครื่อง เก็บเฉพาะ identity ที่ไม่มี secret ใน
  `%ProgramData%\TMTDrugMasterPlatformAgent\installation.json`; config/credential/JHCIS password
  ยังอยู่ใน `%LOCALAPPDATA%` และป้องกันด้วย DPAPI ของ Windows user
- ถ้ายังไม่มีไฟล์ machine identity จะย้าย `installationId` จาก config เดิมแบบ atomic ก่อนสร้างค่าใหม่
- Admin ออก token ที่ผูก `target_installation_id` เพื่อ re-enroll installation เดิมได้ และ Agent ต้องบันทึก
  canonical id ที่ server ตอบกลับ
- เมื่อเปิด enrollment link ใหม่ ตัว tray ที่รันอยู่ต้องโหลด config ใหม่ทันที
  (ทำผ่าน named pipe ใน `single_instance.py`) ไม่ให้ process ที่สองเขียนค่าแล้วตัวแรกใช้ค่าเก่า
- ออก credential ใหม่ก่อน แล้ว revoke credential เดิมของ installation เดียวกัน
  **ต่อเมื่อ Agent ใช้ key ใหม่สำเร็จแล้ว** (การส่ง request ที่เซ็นผ่านคือหลักฐานว่าบันทึกสำเร็จ)
- credential ใหม่บันทึก replacement id แบบ explicit จึงไม่พึ่งลำดับ timestamp ที่อาจชนกัน
- ห้าม revoke Agent เครื่องอื่นใน facility เดียวกัน
- เปลี่ยน facility ต้องตรวจ `office.offid` ใหม่และไม่รับคำสั่งก่อนจับคู่สำเร็จ

### JHCIS query contract

```sql
SELECT drugcode, drugname, drugnamethai, druggenericname,
       drugtype, pack, unitsell, unitusage, cost, sell,
       nationaccount, drugcode24
FROM cdrug
WHERE drugflag = '1'
  AND drugtype IN ('01', '10')
ORDER BY drugcode;
```

ก่อน query ยาต้องอ่าน `office.offid` ที่เป็นรหัส 5 หลักและไม่ใช่ `0000x` ต้องได้สถานบริการเดียวที่แน่นอน
มิฉะนั้นหยุด sync ทั้งหมด อ่านทุกอย่างใน `START TRANSACTION READ ONLY`

### API endpoints (v1)

| Endpoint | เซ็น | หน้าที่ |
|---|---|---|
| `POST /api/v1/agent/enroll` | ไม่ (ใช้ enrollment token ครั้งเดียว) | แลก token เป็น key/secret ของ installation |
| `POST /api/v1/agent/commands/poll` | ใช่ | claim คำสั่งถัดไปแบบ atomic |
| `POST /api/v1/agent/commands/complete` | ใช่ | รายงานผลด้วย `commandId` + `claimToken` |
| `POST /api/v1/agent/sync/begin` | ใช่ | เปิด session พร้อม `expectedRows` |
| `POST /api/v1/agent/sync/batch` | ใช่ | ส่งแถวเข้า staging (สูงสุด 500 แถว/ครั้ง) |
| `POST /api/v1/agent/sync/finish` | ใช่ | ตรวจจำนวนแถวแล้ว commit แบบ atomic |

`commands/complete` ใช้ `claimToken` ใน body แทน command id ใน path เพื่อให้ทุก endpoint เป็น path คงที่
ซึ่งจำเป็นเพราะ path เป็นส่วนหนึ่งของ canonical string ที่ใช้เซ็น

Payload JSON ไม่เกิน 1 MiB เริ่ม batch 300 แถวและลดอัตโนมัติเมื่อเกิน limit

### Authentication ของ Agent

ทุก request หลัง enrollment ส่ง header: `X-Agent-Key`, `X-Agent-Timestamp`, `X-Agent-Nonce`,
`X-Agent-Signature`, `X-Agent-Protocol: 1`

canonical string:

```text
v1\n
POST\n
<path>\n
<unix timestamp>\n
<nonce>\n
<sha256(body bytes)>
```

signature = HMAC-SHA256 ด้วย Agent secret

ฝั่ง server ต้อง: บังคับ HTTPS · constant-time compare · clock skew ไม่เกิน 5 นาที · nonce ใช้ครั้งเดียว ·
ตรวจ credential active + installation + facility ทุก request · ตรวจ `officeId` ตรงกับ facility ของ credential
ทั้ง begin/batch/finish · validate ทุก field ก่อน staging · commit เมื่อ finish สำเร็จเท่านั้น ·
log เฉพาะ key id/error code **ห้าม log secret/password/body**

การเซ็นฝั่ง Python (`agent/windows/tmt_agent/security.py`) กับฝั่ง Node (`src/modules/agent/signature.ts`)
ต้องให้ผลตรงกันทุกไบต์ ถ้าแก้ฝั่งใดฝั่งหนึ่งต้องแก้อีกฝั่งพร้อมกัน

### Polling และคำสั่ง

- poll ทุก 15–30 วินาที พร้อม exponential backoff + jitter เมื่อ Central error
- ถ้าอ่าน JHCIS ไม่ได้ Agent ยังส่ง heartbeat ที่เซ็นแล้วโดย `jhcisConnected=false` แต่ server จะไม่ claim คำสั่ง
  จึงแยกสถานะ Agent online ออกจาก JHCIS unreachable ได้
- server claim command แบบ atomic ป้องกันหลาย process รับงานเดียว
- command มี expiry และ idempotency key; งานที่ค้างเกิน 20 นาทีถูกปล่อยกลับเป็น pending
- command ที่รองรับ: `sync_now`, `test_connection`, `refresh_config`, `upgrade_notice`
- auto sync เป็น policy ที่ Agent ทำเอง ไม่พึ่ง cloud cron

### Build และ packaging

```powershell
cd agent/windows
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\build.ps1
```

เวอร์ชันมาจาก `version.py` ไฟล์เดียว `build.ps1` ตรวจว่าไฟล์ที่ build แล้วรายงานเวอร์ชันตรงกันก่อนถือว่าสำเร็จ

#### Gate ของ build

`build.ps1` จะไม่ยอม package ถ้า gate ใด gate หนึ่งแดง ทั้งสี่ตัวมาจากบั๊กที่เคยหลุดออกไปจริง

| Gate | ดักอะไร |
|---|---|
| `ruff check --select F` | ชื่อที่ไม่มีอยู่จริงและ import ที่ไม่ได้ใช้ — 1.2.1 หลุดออกไปโดยอ้าง `self` ใน `@staticmethod` ทำให้การลงทะเบียนตายด้วย `NameError` ทุกครั้ง |
| `tests/test_signature.py` | canonical string และ HMAC ต้องตรงกับที่เซิร์ฟเวอร์คำนวณ |
| `tests/test_ui_smoke.py` | สร้างหน้าต่างจริงแล้วยิง callback ที่วิ่งเฉพาะบางเส้นทาง รวมถึง copy/paste และ signature ของ `AgentApi.enroll` |
| packaged self-test | รัน `.exe` ที่ build แล้วจริง ดัก lazy import ที่ PyInstaller เก็บไม่ครบ ซึ่งเห็นได้เฉพาะในไฟล์ที่ package แล้ว |

#### Copy / paste ในหน้าตั้งค่า

ทุกช่องกรอกและทุกค่าที่อ่านอย่างเดียวต้อง copy/paste ได้เสมอ กติกาสองข้อที่ห้ามพลาด

1. **ผูกด้วย keycode ไม่ใช่ keysym** — Tk ผูก Ctrl+C/Ctrl+V เดิมไว้กับ keysym และ keysym เปลี่ยนตาม
   keyboard layout พอสลับเป็นแป้นไทย Ctrl+C กลายเป็น Ctrl+แ ไม่มี binding ไหนตรง copy/paste จึงเงียบไป
   `_enable_clipboard` จึงผูก `<Control-KeyPress>` แล้วอ่าน `event.keycode` ซึ่งเป็นปุ่มจริงบนแป้นและไม่ขึ้นกับ layout
   (`VK_A/VK_C/VK_V/VK_X`) พร้อมรองรับ Shift+Insert และ Ctrl+Insert ที่ไม่เคยขึ้นกับ layout อยู่แล้ว
2. **ยิง virtual event ใส่ `tk.Entry` ตัวใน ไม่ใช่ `CTkEntry`** — `CTkEntry` เป็น frame ครอบ `tk.Entry`
   `bind()` ส่งต่อให้ตัวใน แต่ `event_generate()` **ไม่ส่งต่อ** `<<Copy>>` ที่ยิงใส่ตัวครอบจึงตกที่ frame
   ซึ่งไม่มี class binding แล้วเงียบหายไป ใช้ `getattr(entry, "_entry", entry)` เสมอ

`test_ui_smoke.py` ยืนยันทั้งสองข้อด้วยการยิง `<Control-KeyPress>` ที่มี `keycode` แต่ไม่มี keysym ละติน
ซึ่งเป็นรูปแบบเดียวกับที่แป้นไทยส่งมา หน้าต่างต้องถูก map และ focus ก่อน Tk จึงจะส่ง event สังเคราะห์ให้

ก่อนเผยแพร่ Agent รุ่นใหม่ต้องตรวจ code signing, installer ที่หยุด process เดิม, upgrade/uninstall artifact
และการเก็บ machine identity/config ตามนโยบาย โดยใช้ Inno Setup script ที่อยู่ใน repo

---

## 3. ความปลอดภัย

### ความลับ

- Git มีเฉพาะ `.env.example` production secrets ตั้งใน hosting dashboard
- แยก `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, TMT password และ DB password
- ค่าที่เคยเผยแพร่ในการสนทนาหรือไฟล์เดิมถือว่า compromised **ต้อง rotate**
- Agent DB password/secret เก็บด้วย Windows DPAPI; server เก็บ Agent secret แบบ encrypted at rest (AES-256-GCM)
- error/log/audit ต้อง redact password, authorization header, cookie, HMAC, enrollment token และเนื้อไฟล์

### Authentication และ authorization

- password hash ใช้ Node `scrypt` พร้อม parameter/version ฝังใน hash **ห้าม fallback เป็น SHA/MD5**
- rate-limit login/signup/enrollment และบันทึก failed attempts โดยไม่เปิดเผยว่าบัญชีมีจริงหรือไม่
- public rate limit ใช้ fixed-window counter ร่วมใน `rate_limit_buckets`: login 15/5 นาที, signup 5/30 นาที และ Agent enrollment 10/10 นาที ต่อ HMAC ของ IP
  โดยไม่เก็บ raw IP; ถ้าฐานของ limiter ใช้ไม่ได้ให้ fail-open และ log `security.rate_limit_unavailable` โดยไม่ log IP/credential
- Vercel Cron เรียก `GET /api/internal/maintenance/rate-limits/cleanup` วันละครั้งเวลา `30 19 * * *` UTC
  route รับเฉพาะ `Authorization: Bearer <CRON_SECRET>` และ fail closed ก่อน query DB เมื่อ secret ขาดหรือไม่ตรง
- cleanup ลบเฉพาะ bucket ที่ `expires_at` เก่ากว่าเวลาปัจจุบัน 24 ชั่วโมง ครั้งละ 1,000 แถว สูงสุด 10 batches/10,000 แถวต่อ run
  ความล้มเหลว log `security.rate_limit_cleanup_failed` และตอบ 500 โดยไม่เปลี่ยน behavior ของ public limiter; backlog ที่เหลือรอ cron วันถัดไป
- session เป็น opaque random token เก็บ hash ใน DB rotate หลัง login และหลังเปลี่ยน password/role/status
- user ใหม่เป็น `pending` การ activate และการเปลี่ยน role/password ต้อง audit
- authorization เป็น deny-by-default; facility scope มาจาก verified session เท่านั้น
- admin destructive action ต้องเลือก facility และยืนยันด้วยรหัสสถานบริการ พร้อม immutable audit event

### การปกป้องข้อมูล

- TLS ทุก connection: browser, Agent, TiDB, TMT API
- database user ใช้สิทธิ์เท่าที่จำเป็น ไม่ใช้ root
- upload ตรวจ format จากลายเซ็นไฟล์, จำกัดขนาด/จำนวนแถว, เก็บ SHA-256
- ต้องทดสอบ backup/restore จริง และระบุ retention ของ import, export, audit และ staging ก่อน production
- cleanup ของ staging/expired token/nonce เป็น daily job ที่ idempotent

---

## 4. การติดตั้งและใช้งาน

```bash
pnpm install
cp .env.example .env.local
pnpm keys:generate      # คัดลอกค่าที่ได้ไปใส่ .env.local
pnpm db:migrate         # สร้าง/อัปเดตฐานบน TiDB Cloud
pnpm bootstrap:admin    # สร้าง admin ครั้งเดียว รหัสผ่านสุ่มแสดงครั้งเดียว
pnpm dev                # http://localhost:3000
```

ถ้า `pnpm` ไม่อยู่ใน PATH ให้เปิดใช้ผ่าน corepack ที่มากับ Node: `corepack enable pnpm`

`.env.local` ต้องมีอย่างน้อย `DB_*`, `SESSION_SECRET` และ `APP_ENCRYPTION_KEY`
(`APP_ENCRYPTION_KEY` ใช้เข้ารหัส Agent secret ที่เก็บในฐาน จึงขาดไม่ได้)
production ที่เปิด Vercel Cron ต้องตั้ง `CRON_SECRET` แบบสุ่มอย่างน้อย 16 ตัวอักษรใน Vercel environment;
ห้ามใส่ secret ใน query string, config หรือ log
เมื่อต้อง rotate ให้สร้างค่าใหม่ชนิด Secret ใน Production แล้ว redeploy ก่อนยกเลิกค่าเดิม จากนั้นตรวจ request ที่ไม่มีหรือใช้ค่าเดิมว่าตอบ `401`
การตรวจแบบ manual ให้บันทึกจำนวน bucket แยก active/within-grace/expired ก่อนเรียก route, เรียกด้วย bearer ที่ถูกต้องเพียงครั้งเดียว
แล้วตรวจ response `deleted`/`batches`, จำนวน bucket และ log `security.rate_limit_cleanup`; request ที่ไม่มีหรือ bearer ผิดต้องตอบ `401` โดยไม่ query/write DB
`DB_DATABASE` ต้องเป็นฐานเฉพาะของแอป **ห้ามใช้ `sys`**

production ไม่มีตัวแปร `JHCIS_DB_*` เพราะ cloud ไม่ต่อ LAN ค่าเหล่านี้อยู่ใน Agent
`NEXT_PUBLIC_AGENT_INSTALLER_URL` ต้องเป็น URL ของไฟล์ Setup จริงจาก GitHub Release

### Migration

```bash
pnpm db:migrate
```

runner ตรวจ SHA-256 ของ migration ที่รันแล้ว **ห้ามแก้ไฟล์ที่ deploy ไปแล้วแม้แต่คอมเมนต์**
ถ้าแก้ runner จะปฏิเสธด้วย `Applied migration was modified` แก้ด้วย migration หมายเลขถัดไปเท่านั้น
ด้วยเหตุนี้โน้ต rollback จึงอยู่ที่นี่ ไม่ได้อยู่ในไฟล์ `.sql`

**0001_foundation.sql** — สร้างฐานทั้งหมดจากฐานว่างและมี foreign-key ผูกกัน จึงไม่มีการ undo บางส่วน
ให้ restore backup ก่อน migration หรือ drop ฐานทั้งก้อนหลังยืนยันชื่อ cluster และชื่อฐานแล้ว

**0002_agent_commands_and_export.sql** — การ rollback จะลบคิวคำสั่ง Agent และฟิลด์ส่งออกทั้งหมด

```sql
DROP TABLE agent_commands;
DROP TABLE standard_sync_runs;
ALTER TABLE agent_credentials DROP FOREIGN KEY fk_agent_credentials_installation;
ALTER TABLE agent_installations DROP FOREIGN KEY fk_agent_installations_facility;
ALTER TABLE agent_installations DROP COLUMN declared_office_id, DROP COLUMN enrolled_at;
ALTER TABLE drug_mappings
  DROP COLUMN dfscode, DROP COLUMN unit_price, DROP COLUMN distributor, DROP COLUMN ised,
  DROP COLUMN ndc24, DROP COLUMN packsize, DROP COLUMN pack_price,
  DROP COLUMN date_change, DROP COLUMN date_update, DROP COLUMN date_effective, DROP COLUMN notes;
DELETE FROM schema_migrations WHERE filename = '0002_agent_commands_and_export.sql';
```

**0010_mapping_export_checkpoints.sql** — เก็บ version ของ mapping ที่อยู่ในไฟล์ส่งออกสำเร็จล่าสุด แยกตาม facility
การสร้างไฟล์ล็อก facility ระหว่างอ่าน delta และบันทึก checkpoint; preview token ป้องกันจำนวน/ข้อมูลเปลี่ยนระหว่าง preview กับ download

```sql
DROP TABLE export_preview_tokens;
DROP TABLE mapping_export_checkpoints;
ALTER TABLE drug_mappings DROP INDEX uq_mappings_facility_id;
DELETE FROM schema_migrations WHERE filename = '0010_mapping_export_checkpoints.sql';
```

**0011_mapping_review_acknowledgements.sql** — เก็บ current acknowledgement ของ review ต่อ mapping โดยผูกกับ mapping version และ catalog state; audit history ยังอยู่ใน `audit_logs`

```sql
DROP TABLE mapping_review_acknowledgements;
DELETE FROM schema_migrations WHERE filename = '0011_mapping_review_acknowledgements.sql';
```

**0012_agent_identity_management.sql** — เพิ่ม machine heartbeat/JHCIS telemetry, IP ล่าสุด, ความสัมพันธ์ superseded และ target สำหรับ re-enroll Agent เดิม

```sql
DROP INDEX idx_agent_credentials_superseded_by ON agent_credentials;
ALTER TABLE agent_credentials DROP COLUMN superseded_by_credential_id;
DROP INDEX idx_agent_enrollment_target ON agent_enrollment_tokens;
ALTER TABLE agent_enrollment_tokens DROP COLUMN target_installation_id;
ALTER TABLE agent_installations
  DROP COLUMN superseded_by_installation_id,
  DROP COLUMN ip_address,
  DROP COLUMN last_jhcis_check_at,
  DROP COLUMN jhcis_connected,
  DROP COLUMN last_heartbeat_at;
DELETE FROM schema_migrations WHERE filename = '0012_agent_identity_management.sql';
```

**0013_shared_rate_limits.sql** — เพิ่ม fixed-window counter ร่วมสำหรับ public login, signup และ Agent enrollment; ไม่มี foreign key หรือ business data

```sql
DROP TABLE rate_limit_buckets;
DELETE FROM schema_migrations WHERE filename = '0013_shared_rate_limits.sql';
```

ก่อน rollback ต้องหยุด traffic ของ public endpoints หรือ deploy code ที่ไม่เรียกตารางนี้ก่อน ไม่เช่นนั้น limiter จะ fail-open ตาม policy

**0014_tmt_data_model_v2.sql** — เพิ่ม 15 TMT source tables ตามชื่อ endpoint และ `tmt_sync_runs`/`tmt_sync_checkpoints` สำหรับ Phase 3 แบบ additive; ไม่แก้หรือลบ legacy standards/mapping/export tables และยังไม่ถูก apply production ใน Phase 2

Rollback ก่อนมี Phase 3 data/cutover เท่านั้น ต้องหยุด sync v2 และลบตาม dependency order:

```sql
DROP TABLE tmt_sync_checkpoints;
DROP TABLE tmt_version;
DROP TABLE tmt_sync_runs;
DROP TABLE tmt_relationship;
DROP TABLE tmt_concept;
DROP TABLE tmt_mastertmt;
DROP TABLE tmt_regno;
DROP TABLE tmt_atc;
DROP TABLE tmt_nlem;
DROP TABLE tmt_tpp;
DROP TABLE tmt_tpu;
DROP TABLE tmt_tp;
DROP TABLE tmt_gpp;
DROP TABLE tmt_gpu;
DROP TABLE tmt_gp;
DROP TABLE tmt_vtm;
DROP TABLE tmt_subs;
DELETE FROM schema_migrations WHERE filename = '0014_tmt_data_model_v2.sql';
```

**0015_ttmt_data_model_v2.sql** — เพิ่ม `ttmt_imports` และ `ttmt_products` แยก namespace จาก TMT แบบ additive; TTMT importer production เดิมยังไม่ cutover และ migration ยังไม่ถูก apply production ใน Phase 2

```sql
DROP TABLE ttmt_products;
DROP TABLE ttmt_imports;
DELETE FROM schema_migrations WHERE filename = '0015_ttmt_data_model_v2.sql';
```

หลังเริ่ม Phase 3 backfill ห้ามใช้คำสั่ง rollback ข้างต้นแบบ ad-hoc ให้ใช้ maintenance window/backup policy และประเมินข้อมูล sync/import ที่ต้องเก็บก่อนเสมอ

**0016_mapping_v2_identity.sql** — เพิ่ม nullable `standard_source` และ `standard_level` พร้อม index lookup ให้ `drug_mappings`; additive เท่านั้น, ไม่ backfill/เดา legacy identity และ apply production แล้วใน Phase 7.

ก่อนเปิด Mapping v2 ต้อง apply 0016 ผ่าน migration runner, มี TMT/TTMT v2 data ที่ตรวจ invariant แล้ว, ผ่าน local E2E/review regression และเปิดทั้ง `TMT_V2_BROWSER_ENABLED=1` กับ `TMT_V2_MAPPING_ENABLED=1`. ระหว่าง Phase 5 ให้ทั้งสองค่า production เป็น off; legacy mapping/export/catalog ต้องคงเป็น runtime หลัก.

Rollback ก่อนมี data v2 และหลังหยุด feature gate เท่านั้น:

```sql
ALTER TABLE drug_mappings DROP INDEX idx_mappings_standard_identity, DROP INDEX idx_mappings_facility_standard_source,
  DROP COLUMN standard_level, DROP COLUMN standard_source;
DELETE FROM schema_migrations WHERE filename = '0016_mapping_v2_identity.sql';
```

**0017_tmt_run_validations.sql** — เพิ่ม current validation evidence หนึ่ง row ต่อ `tmt_sync_runs.id` สำหรับ policy `validated-unverified-v1`; ผูก approved TTMT import, checkpoint/invariant/GPU evidence และ canonical SHA-256. FK ไป run ใช้ `ON DELETE CASCADE` เพื่อให้ `tmt-v2-only` reset invalidate evidence โดยไม่เพิ่มตารางลง 17-table DELETE allowlist. Migration นี้ยังไม่ apply production ใน Phase 7X.

Rollback ทำได้เฉพาะก่อนเปิด v2 flags/สร้าง validation production โดยหยุด runtime ที่อ้าง schema ก่อน:

```sql
DROP TABLE tmt_run_validations;
DELETE FROM schema_migrations WHERE filename = '0017_tmt_run_validations.sql';
```

### Phase 7 activation prerequisites (ยังห้าม execute)

ก่อน production cutover ต้องได้รับอนุมัติ Phase 7 แยกต่างหากและยืนยันอย่างน้อย:

- migrations 0014–0017 ผ่าน runner เดิมและ journal/hash ตรงบน production database ที่ยืนยัน identity แล้ว
- TMT v2 sync สำเร็จ, invariant report ได้ review และ TTMT import ที่จะใช้มีสถานะ succeeded
- mapping identity/backfill/reset plan, rollback window และผลกระทบ legacy ถูกอนุมัติ
- targeted Catalog/lifecycle/full/delta/preview/XLS regression และ production read-only smoke ผ่าน
- เปิด `TMT_V2_CATALOG_ENABLED`/`TMT_V2_EXPORT_ENABLED` ทีละส่วนตามแผน; ห้ามเปิดล่วงหน้าก่อน schema/data readiness

การปิด flags ต้องคืน runtime ไป legacy `standard_products` path โดยไม่ลบ v2 data. ห้าม drop legacy tables หรือแก้ migration เก่าใน cutover.

### Phase 7A readiness tooling (ยังห้าม production execute)

- `pnpm phase7:maintenance` อ่าน/เปิด/ปิด persistent `maintenance_mode` ใน encrypted `app_settings`; transition ที่เปลี่ยน state จริงสร้าง audit และ same-state เป็น no-op
- เมื่อ maintenance ON, server ตอบ `503 MAINTENANCE_MODE` หลัง authentication แต่ก่อน write ของ Agent sync/command, Catalog import/reconcile, Mapping save/review, Export preview/download และ admin facility-data clear; login/admin/read-only ยังทำงาน
- `pnpm tmt:v2:sync` reuse Phase 3 full/incremental/resume engine และ full เริ่ม `2013-01-01`; `pnpm ttmt:v2:import` เขียนเฉพาะ `ttmt_imports`/`ttmt_products`
- TMT runner fail run เมื่อ invariant โครงสร้างผิด (counterpart/level/MasterTMT/unknown/duplicate edge); FSN, dangling/self edge และ enrichment conflicts เป็น reviewable warnings ตาม source behavior ที่ยืนยันแล้ว
- `pnpm phase7:preflight` เป็น SELECT-only และคืน non-zero เมื่อ migration/maintenance/credential/table/MasterTTMT/flag gate ไม่พร้อม; `validated_unverified` ผ่าน readiness แต่รายงาน warning `TMT_V2_VALIDATED_UNVERIFIED`
- `pnpm tmt:v2:validate -- --environment <local|production> --env-file <explicit> --run-id <uuid> --dry-run` ตรวจ terminal full-unverified run, required checkpoints, imagelist-only failures, blocking invariants, GPU `764169` และ approved TTMT identity. การ persist ต้องใช้ `--execute --confirm-db <exact database>`, maintenance ON และ migration 0017; transaction fail ทั้งก้อนเมื่อ validation ใดไม่ผ่าน
- `pnpm phase7:reset` default dry-run และต้องระบุ `--mode full|tmt-v2-only`; โหมด `tmt-v2-only` ใช้ exact 17-table DELETE allowlist ใน transaction และตรวจ counts ของ KEEP/business/TTMT/legacy tables ว่าไม่เปลี่ยน ต้องมี backup reference และ execute ต้องเพิ่ม `--execute --confirm-db <exact database>`
- production execution ของ runner/import/reset/validation ต้องยืนยัน TiDB Cloud host, port 4000, database `drug_master_platform`, migrations ตามที่ command ต้องใช้ (validation ต้องถึง 0017), maintenance ON และ env file explicit; ห้ามพิมพ์ credential

Rollback ของ maintenance boundary คือ disable ผ่าน CLI ที่ guard แล้วหลังตรวจ cutover state; reset ไม่มี automatic rollback หลัง commit จึงต้องอาศัย verified backup reference และ maintenance window. Phase 7A ไม่ apply migration, ไม่ reset, ไม่ sync/import และไม่เปิด flags บน production. Production MasterTTMT ของจริงยังต้องมาจาก owner ก่อน cutover.

DB integration tests เป็น fail-closed operational invariant: ต้อง opt-in ด้วย `ALLOW_DB_INTEGRATION_TESTS=1`, รันใน `NODE_ENV=test`, ใช้เฉพาะ localhost และฐานชื่อ `drug_master_*test`; test ห้ามโหลดหรือ fallback ไป `.env.local` ที่ production-equivalent

### TMT v2 sync engine operational state

- Phase 3 engine ไม่มี route, cron หรือ automatic import ที่เริ่ม TMT sync ใน production; `/api/v1/admin/tmt-operations` เป็น read-only admin status/history endpoint เท่านั้น
- `/admin` แสดง readiness, recent runs และ checkpoint ของ current TMT v2 pipeline สำหรับผู้ดูแลระบบ แต่การเริ่ม/resume ยังต้องผ่าน CLI `pnpm tmt:v2:sync` พร้อม environment/database/mode guards เดิม
- `/api/v1/admin/ttmt-import` รับ MasterTTMT ผ่าน current TTMT v2 importer สำหรับ admin เท่านั้น, ใช้ `ttmt_imports`/`ttmt_products` และ audit เดิม; ไม่ใช้ legacy `standard_products` route หรือ pipeline
- run ผูกกับ `/version` ก่อน/หลัง, ใช้ checkpoint ต่อ endpoint/window และ data write + checkpoint success อยู่ transaction เดียวกัน
- initial windows เริ่ม `2013-01-01` สูงสุด 365 วัน; incremental ใช้ cursor แยก endpoint พร้อม overlap 30 วัน
- timeout/network/429/5xx retry สูงสุด 3 attempts พร้อม bounded exponential backoff/jitter และ `Retry-After`; 401/403 refresh token ได้ครั้งเดียว
- core 13 data endpoints ต้องผ่านทั้งหมด; ATC และ imagelist failure เป็น warning, image เป็น on-demand เท่านั้น
- persistence ไม่ prune จาก absence, ไม่ regress change date, เก็บ temporal NLEM/ATC/RegNo และรายงาน same-date conflict
- controlled local live verification ใช้ version `20261102`, core ready และ incremental replay เขียนใหม่ 0; production migration/cutover ยังเป็น **NO**

#### Degraded full sync preparation

`pnpm tmt:v2:sync -- --mode full-unverified` เป็น one-shot recovery mode สำหรับกรณี `/version` ว่างเท่านั้น ไม่ใช่ fallback ของ `resume`. Execution ยังคงต้องผ่าน production fingerprint, maintenance, `--execute` และ `--confirm-db <exact database>` ตาม guard เดิม และ engine จะปฏิเสธก่อนสร้าง run หากตาราง TMT v2 source/run/checkpoint/version ใดมีข้อมูล ดังนั้นต้องมี reset ที่อนุมัติแยกก่อนเสมอ.

Run ใช้ `mode=full_unverified`, marker `unverified:<20 hex>` และ terminal `status=unverified`/`TMT_VERSION_UNVERIFIED`; ไม่มีการเขียน `tmt_version` observation, ไม่สามารถ resume และไม่รายงาน `coreReady`. Core 13 endpoints และ ATC ต้องผ่าน retries/checkpoints ภายใน process เดียว; ImageList retry ตามปกติแต่ failure ถูกเก็บเป็น failed checkpoint/optional warning และไม่ปิด run. หลังจากนั้น blocking invariants และ acceptance ของ GPU `764169` ต้องผ่าน. แม้สำเร็จ ห้าม import TTMT, เปิด v2 flags หรือปิด maintenance จนกว่าจะได้รับ approval หลัง review counts/invariants แยกต่างหาก.

Phase 7I เพิ่มเฉพาะ capability นี้และ **ไม่ execute production reset/sync**.

### TMT Browser v2 activation gate

`TMT_V2_BROWSER_ENABLED` default-off และต้องมีค่า exact `1` จึงเปิด hidden `/admin/tmt-v2` กับ API read-only. ก่อนเปิดใน environment ใดต้องยืนยันครบ: migrations 0014/0015 ถูก apply ด้วย runner เดิม, v2 sync สำเร็จ, invariant report ได้ review แล้ว และผู้รับผิดชอบอนุมัติ enable flag. การเปิด flag ก่อน schema พร้อมจะทำให้ browser ใช้งานไม่ได้ จึงห้ามเพิ่ม production env ใน Phase 4. ปิด flag เป็น rollback ของ browser โดยไม่เปลี่ยน legacy standards/mapping/export/catalog paths.

การมี env flag เพียงอย่างเดียวไม่พอ: Browser, Mapping, Catalog/lifecycle และ Export v2 ใช้ central readiness เดียวกัน. Versioned run ต้อง `succeeded`; `full_unverified` ต้องคง `status=unverified`/`TMT_VERSION_UNVERIFIED` และมี validation policy `validated-unverified-v1` ที่ checkpoint snapshot, canonical evidence digest และ TTMT import ปัจจุบันตรงกัน. Evidence หาย/ผิด policy/TTMT เปลี่ยน/checkpoint เปลี่ยนตอบ `503 TMT_V2_NOT_READY`; ระบบไม่แก้หรือปิด env flag ให้อัตโนมัติ และ UI ต้องแสดง degraded status.

การล้าง Agent test data ใช้ `scripts/purge-agent-test-data.mjs --env <ไฟล์>` เพื่อดูจำนวนแบบ dry-run ก่อนเท่านั้น
การลบจริงต้องเพิ่ม `--execute-agent-test-data --confirm-database <ชื่อฐานตรงกัน>` และต้องได้รับอนุมัติฐาน/ขอบเขตก่อน สคริปต์ไม่ลบ `source_drugs`
และจะเก็บ `agent_sync_sessions` ที่ยังถูกอ้างด้วย `source_drugs.last_seen_sync_id` เพื่อไม่ทำลาย provenance ของ business snapshot

ห้ามใช้ rollback บน production โดยไม่มี maintenance window ที่อนุมัติแล้ว

### บัญชี admin ตัวแรก

`pnpm bootstrap:admin` สร้าง admin กลางได้ครั้งเดียว และจะปฏิเสธถ้ามี admin อยู่แล้ว
ปกติจะสุ่มรหัสผ่านและแสดงครั้งเดียว ถ้าตั้ง `BOOTSTRAP_ADMIN_PASSWORD` ใน `.env.local`
จะใช้ค่านั้นแทน — สะดวกตอนพัฒนา แต่สคริปต์จะปฏิเสธเมื่อ `NODE_ENV=production`

บัญชีนี้ถูกตั้ง `must_change_password = 1` เสมอ และควรลบ `BOOTSTRAP_ADMIN_PASSWORD`
ออกจาก `.env.local` ทันทีหลัง login ครั้งแรก

---

## 5. Production verification checklist

ระบบ deploy production แล้ว ส่วนนี้แยกหลักฐานที่ตรวจแล้วออกจาก hardening ที่ยังค้าง
เพื่อไม่ให้ deployment status ถูกตีความว่า checklist ทุกข้อผ่าน ดู checkpoint ล่าสุดที่ [PROJECT_STATUS.md](PROJECT_STATUS.md)

### Verified

- [x] migrations production ผ่านถึง `0013_shared_rate_limits.sql`
- [x] shared DB rate limit สำหรับ login/signup/enrollment ผ่าน controlled production verification
- [x] daily expired rate-limit bucket cleanup และ `CRON_SECRET` เปิดใช้บน production; cron `30 19 * * *` UTC และ controlled invocation ผ่าน
- [x] Agent 1.3.0 fresh enrollment/re-enrollment, credential rotation และ duplicate protection ผ่าน controlled verification
- [x] `office.offid` ต้องตรงกับ facility สำหรับ sync และ mismatch ถูกปฏิเสธ
- [x] heartbeat รายงาน Agent online แยกจาก JHCIS unreachable ได้
- [x] Mapping lifecycle/review acknowledgement และ Export full/delta checkpoint ผ่าน targeted production verification
- [x] installer รักษา ProgramData installation identity หลัง restart/uninstall/reinstall ใน local controlled test

### Outstanding

- [ ] ทดสอบ tenant isolation แบบ exhaustive ครบทุก API รวม body/query ที่ปลอม `facilityId`
- [ ] enforce `must_change_password` flow ให้ครบ
- [ ] ทบทวน CSP/security headers
- [ ] ทดสอบ Excel contract ด้วย Excel จริงทุกครั้งที่มีการแก้ writer; ตรวจเลขศูนย์นำหน้า, NDC24, ภาษาไทยและวันที่
- [ ] ทดสอบ installer matrix เพิ่มเติมบน Windows 10/11, non-admin user และชื่อเครื่อง/พาธภาษาไทย
- [ ] ทดสอบ sync ปริมาณ 30,000 แถวและ incomplete-session failure บน environment ที่ควบคุมได้

### Operational follow-up

- [ ] เพิ่ม CI workflow และ monitoring/alert สำหรับ Agent, TMT sync, import/export และ auth anomaly
- [ ] เพิ่ม automatic cleanup สำหรับ staging, expired token/nonce และ preview records
- [ ] ทำ backup/restore drill และกำหนด retention policy ของ import, export, audit และ staging
- [ ] reconcile production checklist/UAT กับ owner เป็นระยะโดยไม่ตีความ deployment ว่าเท่ากับผ่านทุก gate
