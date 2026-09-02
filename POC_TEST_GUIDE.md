# Connectivity PoC Test Guide

PoC นี้พิสูจน์เฉพาะการเชื่อมต่อ Web/TMT/JHCIS/Tray และยังไม่ใช่ระบบ Drug Master จริง ห้ามใช้ in-memory state/replay cache เป็น production control

## 1. เตรียม Web local

ต้องมี Node.js และ `pnpm` จากนั้น:

```powershell
pnpm install
pnpm poc:credentials
Copy-Item .env.example .env.local
```

นำค่าที่แสดงครั้งเดียวจาก `poc:credentials` ใส่ `.env.local` ด้วยตนเอง ห้าม commit ไฟล์นี้ หากจะทดสอบ TMT จริงให้ใส่ `TMT_API_USER` และ `TMT_API_PASSWORD` ปัจจุบันเอง จากนั้น:

```powershell
pnpm dev
```

เปิด `http://localhost:3000/poc` แล้วกรอก `POC_DASHBOARD_TOKEN` เพื่อดู Agent/event หรือกดทดสอบ TMT

## 2. ตรวจ Web และ test อัตโนมัติ

```powershell
pnpm typecheck
pnpm lint
pnpm test
Invoke-RestMethod http://localhost:3000/api/poc/health
```

TMT unit test ใช้ mock และไม่มี credential จริง การที่ test นี้ผ่านไม่ได้หมายความว่า live TMT ผ่าน

## 3. รัน Windows Tray จาก source

```powershell
cd agent/windows-poc
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --requirement requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe app.py
```

กรอก Server URL, Agent Key/Secret และ JHCIS connection เอง รหัสผ่านฐานไม่มีค่า default และถูกเก็บด้วย Windows DPAPI ใต้ `%LOCALAPPDATA%\TMTDrugMasterAgentPoc\` Log บันทึกเฉพาะ operation/error code แบบ sanitized

ทดสอบตามลำดับ:

1. กด `ทดสอบ Web API` และตรวจว่าได้ web version
2. กด `ทดสอบ JHCIS` และตรวจ officeId/จำนวนยา 01/10
3. กด `ส่งผลทดสอบขึ้นเว็บ` และเก็บ Request ID
4. กลับหน้า `/poc` ตรวจ Agent/event ล่าสุด
5. กด `บันทึกและย่อไป Tray` จากนั้นเปิด `เปิดหน้าตั้งค่า` และเปลี่ยน Server URL/JHCIS host เพื่อทดสอบซ้ำ

Agent เปิด `START TRANSACTION READ ONLY`, อ่าน `office.offid` และรันเฉพาะ `COUNT(*)` ที่กรอง `drugflag='1'` และ `drugtype IN ('01','10')`; ไม่มี query รายการยาและไม่มีคำสั่งเขียน

## 4. Build portable EXE

หลัง source test ผ่าน:

```powershell
cd agent/windows-poc
.\build.ps1
```

ผลลัพธ์อยู่ `artifacts/poc/TMTDrugMasterAgentPoc.exe` และถูก ignore จาก Git สคริปต์ล้างเฉพาะ output PoC ของ repository นี้ ไม่ kill/delete process หรือ artifact ของโครงการอื่น Installer ยังไม่ทำจน portable ผ่านบน Windows 10/11

## 5. Public HTTPS test

1. Push source โดยยืนยันว่าไม่มี `.env.local`, config, log หรือ `artifacts/poc/`
2. Deploy Next.js ไปยัง Node host/Vercel และตั้ง environment ทั้งหมดใน dashboard
3. เปิด `https://<deployment>/api/poc/health`
4. ใส่ HTTPS URL ใน Tray แล้วทดสอบ Web/JHCIS/report ตามลำดับ
5. บันทึกเวลา, HTTP status, latency, officeId, count และ Request ID โดยไม่บันทึก credential/header

In-memory Agent/event state และ nonce cache อาจหายหรือแยกกันระหว่าง serverless instances สำหรับ production ต้อง implement `PocStateStore`/`ReplayStore` ด้วย transactional TiDB หรือ Redis/KV ที่รองรับ atomic claim; ห้ามอ้างว่า adapter ปัจจุบันป้องกัน replay ข้าม instance ได้

## Test results

ผลจริง ณ 2026-09-02 (local Windows 10):

| รายการ | ผล | หมายเหตุ |
|---|---|---|
| TypeScript typecheck/lint/unit tests | PASS | `pnpm typecheck`, `pnpm lint`, Vitest 18 tests |
| Next.js production build | PASS | Next.js 16.3.4, routes `/poc` และ `/api/poc/*` build สำเร็จ |
| Local health | PASS | HTTP 200, service/version/time ถูกต้อง |
| Invalid/missing HMAC | PASS | missing ถูกปฏิเสธ HTTP 401; invalid/replay มี integration test |
| Fixed HMAC TypeScript/Python | PASS | shared UTF-8 fixed vector ตรงกัน |
| officeId validation/scope | PASS | malformed HTTP 422, mismatch HTTP 403 |
| Payload > 64 KiB | PASS | HTTP 413 |
| Python Tray client -> local Web API | PASS | health version 0.1.0 |
| Tray -> JHCIS localhost | NOT TESTED | port 3333 เปิด แต่ไม่ใช้/เดา database credential; ต้องทดสอบกับ JHCIS จริง |
| Python Tray client signed report -> request ID | PASS | local server รับ HTTP 202 และ dashboard เห็น office/count จาก synthetic smoke input |
| TMT mock | PASS | token + `/version`, auth failure และ invalid JSON ผ่าน unit tests |
| TMT live | NOT TESTED | server ตอบ `TMT_CONFIG_MISSING`; ต้องใส่ credential ปัจจุบันเอง |
| `/poc` UI desktop/360 px | PASS | browser visual/DOM, async dashboard update และ console ไม่มี error |
| Portable EXE build/start/single-instance startup | PASS | 30,117,891 bytes; SHA-256 `81B38953D8B0DB84FF251582F4B67E7080A284C89A8D64827883275FBD0EC358` |
| Tray icon/buttons/reopen settings แบบผู้ใช้คลิก | NOT TESTED | process เปิดค้างได้จริง แต่ยังต้องทำ manual interaction พร้อม JHCIS config |
| Public HTTPS deployment | NOT TESTED | ยังไม่มี deployed URL |
