# การทำงานและการขึ้นระบบ (OPERATIONS)

เอกสารนี้อธิบายว่าระบบ **ทำงานอย่างไรและขึ้นระบบอย่างไร** ส่วน **ต้องทำอะไร** อยู่ใน [SPEC.md](SPEC.md)

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

ก่อนเผยแพร่จริงยังต้องมี: code signing certificate · installer (WiX/Inno) ที่หยุด process เดิม
ถอนเวอร์ชันเก่าที่ product code เดียวกัน และล้าง shortcut/uninstall entry · เก็บ config เฉพาะตอน upgrade
และให้เลือกเก็บ/ลบอย่างชัดเจนตอน uninstall

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

## 5. Checklist ก่อนขึ้น production

ระบบยัง **ไม่ควร deploy เป็น production** จนกว่ารายการนี้จะผ่านครบ

**การแยกข้อมูลระหว่างสถานบริการ (บังคับ)**

- [ ] ผู้ใช้ facility A เรียก API ทุกเส้นแล้วต้องไม่เห็นข้อมูลของ facility B
- [ ] admin ที่ยังไม่เลือก facility ถูกปฏิเสธด้วย `FACILITY_CONTEXT_REQUIRED`
- [ ] ส่ง `facilityId` ปลอมทาง body/query ต้องไม่มีผลต่อ scope

**Agent (ต้องมีฐาน TiDB และ JHCIS จริง)**

- [ ] enroll ครั้งแรก, reconnect เครื่องเดิม, ย้าย facility
- [ ] `office.offid` ไม่ตรง → ปฏิเสธทั้ง begin/batch/finish
- [ ] ส่ง request ซ้ำด้วย nonce เดิม → ปฏิเสธ
- [ ] sync 30,000 แถว: staging ครบแล้วจึง commit และแถวที่หายไปถูกปิดใช้งาน
- [ ] finish ที่จำนวนแถวไม่ครบ → ปฏิเสธและ session เป็น failed

**ไฟล์ส่งออก**

- [ ] เปิดไฟล์ที่ส่งออกด้วย Excel จริงบน Windows
- [ ] preview count = จำนวนแถวในไฟล์
- [ ] เลขศูนย์นำหน้า, NDC24, ภาษาไทย, วันที่ ถูกต้องครบตามข้อ 9 ของ SPEC

**Installer**

- [ ] ติดตั้งใหม่, upgrade ทับเวอร์ชันเดิม, ถอนการติดตั้ง
- [ ] Windows 10/11, ผู้ใช้ที่ไม่ใช่ admin, ชื่อเครื่อง/พาธภาษาไทย

**ระบบ**

- [ ] rotate secrets ทุกตัวและ secret scan ไม่พบค่าเดิม
- [ ] migrations รันบน staging clone และมี backup/rollback plan
- [ ] Thai/utf8mb4 round-trip ผ่าน
- [ ] CSP, secure headers, HTTPS redirect, secure cookies, rate limits พร้อม
- [ ] monitoring/alert สำหรับ Agent failures, TMT sync, import/export และ auth anomalies
- [ ] backup/restore drill ทำจริงแล้ว
- [ ] owner ลงนาม UAT
