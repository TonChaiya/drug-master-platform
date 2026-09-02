# Prompt: สร้าง Connectivity PoC ก่อนเริ่มระบบจริง

คัดลอกข้อความทั้งหมดตั้งแต่หัวข้อ “PROMPT” ไปใช้กับ Codex ในโฟลเดอร์ `C:\laragon\www\16.Drug_Master_Platform`

---

## PROMPT

คุณกำลังทำงานใน `C:\laragon\www\16.Drug_Master_Platform`

งานนี้เป็น **Connectivity Proof of Concept (PoC) เท่านั้น** ยังไม่อนุญาตให้สร้างระบบ Drug Master ฉบับเต็ม เป้าหมายคือพิสูจน์ให้ได้ก่อนว่า:

1. Windows Tray Agent ติดต่อเว็บ Next.js ผ่าน HTTPS ได้จริง
2. เว็บ Next.js ติดต่อ TMT API จากฝั่ง server ได้จริง
3. Tray ติดต่อฐาน JHCIS ใน LAN ได้ อ่านรหัสสถานบริการจาก `office.offid` และนับรายการยาเงื่อนไขจริงได้
4. Tray ส่งเฉพาะผลตรวจและจำนวนรายการขึ้นเว็บได้ โดยยังไม่ส่งรายการยาจริงทั้งหมด
5. Tray เปิดหน้าตั้งค่าใหม่ เปลี่ยน Server URL/JHCIS host และทดสอบซ้ำได้หลังเชื่อมสำเร็จแล้ว

ห้ามเริ่มสร้างหน้า mapping, DrugCat import/export, dashboard เต็ม, user management, TiDB schema เต็ม หรือ migration ข้อมูลเดิม จนกว่า PoC ทั้งหมดจะผ่านและผู้ใช้สั่งให้เริ่มระบบจริง

### 1. อ่านข้อมูลก่อนลงมือ

อ่านไฟล์เหล่านี้ให้ครบก่อนแก้ไข:

- `README.md`
- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/AGENT_PROTOCOL.md`
- `docs/TMT_API.md`
- `docs/SECURITY_AND_DEPLOYMENT.md`
- `docs/TEST_PLAN.md`
- `docs/LEGACY_TRACEABILITY.md`

ดูระบบเดิมแบบ read-only เฉพาะส่วนที่จำเป็นจาก:

- `C:\laragon\www\15.Drug_Master_Platform-old\agentAutoData\src\tray_agent.py`
- `C:\laragon\www\15.Drug_Master_Platform-old\app\TmtApiClient.php`
- `C:\laragon\www\15.Drug_Master_Platform-old\app\SyncService.php`
- `C:\laragon\www\15.Drug_Master_Platform-old\tmtapi_manual.pdf`

ห้ามคัดลอก secret, `.env`, database dump, user data หรือไฟล์ build เก่าเข้ามา และห้ามแก้ระบบเดิม

### 2. วางแผนก่อนเขียน

สำรวจโฟลเดอร์ปัจจุบันและรายงานไฟล์ที่จะสร้าง/แก้ จากนั้นทำแผนสั้น ๆ แบ่งเป็น:

1. Next.js PoC web
2. Windows Tray PoC
3. local integration test
4. public HTTPS test preparation
5. build artifacts และคู่มือทดสอบ

ดำเนินงานตามแผนต่อได้เลยโดยไม่ต้องถามในรายละเอียดที่ค้นจากเอกสารหรือระบบเดิมได้ แต่ถ้าต้องใช้ URL เว็บที่ deploy แล้วหรือ credential ที่ไม่มี ให้สร้าง placeholder และบอกจุดที่ผู้ใช้ต้องกรอก ห้ามเดาค่า

### 3. Next.js PoC web

สร้าง Next.js รุ่นปัจจุบันแบบ App Router + TypeScript ในโฟลเดอร์นี้ โดยรักษาไฟล์ Markdown ที่มีอยู่ทั้งหมด ใช้ `pnpm` และเปิด TypeScript strict

สร้างหน้าเว็บเดียว `/poc` แบบ compact responsive ภาษาไทย แสดงการ์ดเล็ก ๆ:

- Web API: online/offline และ server time
- TMT API: success/failure, HTTP status, latency และ `tmt_version` ถ้าดึงได้
- Agent ล่าสุด: machine name, agent version, officeId, JHCIS status, จำนวนยา 01/10, เวลาได้รับ และ request ID
- ปุ่มทดสอบ TMT API
- ตาราง event ล่าสุดแบบไม่แสดง secret/password/Authorization header

หน้าเว็บต้อง update ผ่าน fetch โดยไม่ full-page reload และไม่เด้งกลับด้านบน

สร้าง Route Handlers ขั้นต่ำ:

#### `GET /api/poc/health`

ตอบ JSON:

```json
{
  "ok": true,
  "service": "tmt-drug-master-poc",
  "serverTime": "ISO-8601",
  "version": "single-source-version"
}
```

#### `POST /api/poc/tmt/version`

- เรียก TMT token endpointจากฝั่ง server แล้วเรียก `/version` ตามคู่มือ
- credential อ่านจาก environment เท่านั้น
- ห้ามส่ง token, username หรือ password กลับ browser/log
- ตอบเฉพาะ `ok`, `tmtVersion`, `latencyMs`, `errorCode`, `message` แบบ sanitized
- เปิด TLS verification เสมอใน production
- timeout ชัดเจนและจัดการ remote disconnect/invalid JSON/401/403/5xx แยกกัน

#### `POST /api/poc/agent/report`

รับรายงานจาก Tray โดยมีขอบเขตเพียง:

```json
{
  "installationId": "UUID",
  "machineName": "string",
  "agentVersion": "string",
  "officeId": "5 digits",
  "jhcisConnected": true,
  "eligibleDrugCount": 123,
  "checkedAt": "ISO-8601"
}
```

ห้ามรับชื่อยา รายการยา หรือ database password ใน PoC นี้

ป้องกัน endpoint ด้วย HMAC-SHA256 ตาม canonical form ใน `docs/AGENT_PROTOCOL.md` ใช้ `POC_AGENT_KEY` และ `POC_AGENT_SECRET` จาก environment ชั่วคราว พร้อมตรวจ:

- key ตรง
- timestamp ไม่เกิน 5 นาที
- nonce รูปแบบถูกและกัน replay อย่างดีที่สุดในข้อจำกัด PoC
- body hash/signature แบบ constant-time
- request body limit ไม่เกิน 64 KiB
- `officeId` เป็นเลข 5 หลักและไม่ใช่ `0000x`

ถ้า serverless memory ไม่รับประกัน replay protection ข้าม instance ให้ระบุข้อจำกัดชัดเจนและสร้าง adapter interface สำหรับเปลี่ยนเป็น TiDB/Redis ในระบบจริง ห้ามอ้างว่า memory replay cache ปลอดภัยพอสำหรับ production

สำหรับหน้า `/poc` ให้เก็บ “Agent ล่าสุด/event ล่าสุด” ผ่าน adapter สองแบบ:

- local development: in-memory store เพื่อทดสอบเร็ว
- public serverless: ถ้ายังไม่มี TiDB ให้แสดงผลจาก response ล่าสุดใน browser หรือใช้ optional KV ที่กำหนดผ่าน env ห้ามแอบเพิ่มบริการเสียเงิน

ต้องระบุชัดว่า state แบบ in-memory อาจหายเมื่อ function restart และไม่ใช่แบบ production

### 4. Environment

อัปเดต `.env.example` โดยใช้ placeholder เท่านั้น:

```dotenv
TMT_API_BASE=https://tmt.this.or.th/tmtapi
TMT_API_USER=
TMT_API_PASSWORD=
POC_AGENT_KEY=
POC_AGENT_SECRET=
POC_ALLOWED_OFFICE_ID=05957
```

ห้ามนำ credential จากบทสนทนา ระบบเดิม หรือไฟล์เก่ามาใส่เอง ผู้ใช้จะกรอก `.env.local` ภายหลัง

เพิ่ม script สำหรับสร้าง `POC_AGENT_KEY` และ `POC_AGENT_SECRET` แบบ cryptographically secure โดยแสดงครั้งเดียวและไม่เขียนลง Git

### 5. Windows Tray PoC

สร้าง source ใหม่ใน `agent/windows-poc/` ห้ามนำ binary/tray build เก่ามาใช้

เลือก Python เวอร์ชันที่ build เป็น Windows executable ได้ง่าย โดยใช้ GUI/tray library ที่เสถียรและ dependency น้อย สร้าง UI ภาษาไทยที่มี:

- Server URL เช่น `https://example.vercel.app`
- Agent Key
- Agent Secret แบบซ่อนค่า
- JHCIS Host ค่าเริ่มต้น `127.0.0.1`
- Port ค่าเริ่มต้น `3333`
- Database ค่าเริ่มต้น `jhcisdb`
- User ค่าเริ่มต้น `root`
- Database password แบบซ่อนค่า ค่าเริ่มต้นให้ผู้ใช้กรอกเอง ห้าม hard-code ใน source/build
- ปุ่ม `ทดสอบ JHCIS`
- ปุ่ม `ทดสอบ Web API`
- ปุ่ม `ส่งผลทดสอบขึ้นเว็บ`
- ปุ่ม `บันทึกและย่อไป Tray`

Tray menu ต้องมี:

- สถานะล่าสุด
- เปิดหน้าตั้งค่า
- ทดสอบใหม่
- เปิด log แบบ sanitized
- ออกจากโปรแกรม

ข้อกำหนด:

- single instance
- หน้าตั้งค่าเปิดได้ตลอดแม้เคยเชื่อมสำเร็จ
- config เก็บใต้ `%LOCALAPPDATA%\TMTDrugMasterAgentPoc\`
- Agent Secret และ DB password ป้องกันด้วย Windows DPAPI
- log ห้ามมี secret/password/full Authorization/HMAC
- HTTPS required ยกเว้น `localhost`, `127.0.0.1` และ `.test` สำหรับ local development
- มี timeout, retry แบบจำกัด และข้อความ error ที่บอก DNS/TLS/timeout/HTTP/auth/remote disconnect ต่างกัน
- ใช้ MySQL driver ที่รองรับ authentication ของ JHCIS เดิม รวม dependency ใน build ให้ครบ และมี test connection จริง

JHCIS test ต้องทำเพียง:

1. เปิด read-only connection
2. อ่าน `office.offid`
3. ยืนยันเป็นเลข 5 หลักและไม่ใช่ `0000x`
4. ถ้ามี `POC_ALLOWED_OFFICE_ID`/office ที่กำหนดจากเว็บ ต้องตรงกัน
5. นับด้วย query:

```sql
SELECT COUNT(*)
FROM cdrug
WHERE drugflag = '1'
  AND drugtype IN ('01', '10');
```

ห้าม SELECT รายการยาเต็มและห้ามเขียน JHCIS

สร้าง HMAC จาก body bytes จริงให้ตรงกับ Route Handler และเพิ่ม unit test ด้วย fixed test vector ทั้ง TypeScript และ Python ต้องให้ signature เดียวกัน

### 6. Version และ build

- ใช้ version source เดียวต่อส่วน ห้ามเกิดกรณี source/installer คนละเวอร์ชัน
- สำหรับ PoC ให้ build portable `.exe` ก่อนเพื่อทดสอบ; installer ทำเมื่อ portable ผ่าน
- สร้าง build script ที่ reproducible และล้างเฉพาะ output ของ PoC ตัวเอง
- ห้าม kill/delete tray หรือ installer ของโปรเจกต์อื่น
- output อยู่ `artifacts/poc/` ซึ่งถูก ignore จาก Git
- สร้าง `POC_TEST_GUIDE.md` บอกวิธีรัน local, ตั้ง env, build Tray, ทดสอบ public URL และเก็บหลักฐานผล

### 7. การทดสอบที่ต้องผ่าน

รันเฉพาะงาน PoC ที่สร้างใหม่และรายงานคำสั่ง/ผลจริง:

1. TypeScript typecheck/lint/unit tests
2. `GET /api/poc/health` local สำเร็จ
3. invalid/missing HMAC ถูกปฏิเสธ
4. fixed HMAC vector ตรงกันระหว่าง TypeScript/Python
5. officeId ผิดรูปแบบหรือไม่ตรงถูกปฏิเสธ
6. payload เกิน limit ถูกปฏิเสธ
7. Tray test Web API กับ local Next.js สำเร็จ
8. Tray test JHCIS localhost สำเร็จและรายงานเฉพาะ officeId/count
9. Tray ส่ง report แล้วได้ request ID/ผลตอบกลับสำเร็จ
10. TMT `/version` ทดสอบจริงเมื่อผู้ใช้ใส่ credential; ถ้ายังไม่มี credential ให้ test mock ผ่านและรายงานว่า live test ยัง pending ห้ามอ้างว่าสำเร็จ
11. build portable Tray แล้วเปิดบน Windows ได้, icon/tray/settings ทำงาน และเปิดตั้งค่าใหม่หลังเชื่อมแล้วได้

ห้ามสรุปว่า “PoC ผ่าน” หากข้อ 7–9 ยังไม่ได้ทดสอบจริง และห้ามสรุปว่า “TMT API ผ่าน” ถ้ายังใช้ mock หรือยังไม่ได้ใส่ credential

### 8. สิ่งที่ต้องส่งมอบ

- Next.js PoC source ที่พร้อม push GitHub/deploy
- Windows Tray PoC source
- portable Tray executable เมื่อ build ผ่าน
- `.env.example` ไม่มี secret
- `POC_TEST_GUIDE.md`
- test results สั้น ๆ แยก `PASS`, `FAIL`, `NOT TESTED`
- รายการข้อจำกัดก่อนเปลี่ยนจาก PoC เป็น production

เมื่อส่งมอบ ให้หยุดที่ PoC และรอคำสั่งผู้ใช้ก่อนเริ่ม Phase 1 ของระบบ Drug Master จริง

---

## หมายเหตุสำหรับผู้ใช้

ก่อนทดสอบ TMT API จริง ให้สร้าง `.env.local` เองและใส่ credential ปัจจุบัน ห้ามส่งไฟล์ `.env.local` เข้า GitHub สำหรับการทดสอบ Tray กับเว็บ public ต้อง deploy Next.js PoC ก่อน แล้วนำ URL HTTPS ที่ได้ไปใส่ใน Tray

