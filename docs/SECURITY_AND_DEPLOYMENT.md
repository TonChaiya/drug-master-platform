# Security and Deployment

## Secrets

- Git มีเฉพาะ `.env.example`; production secrets ตั้งใน hosting dashboard
- แยก `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, TMT password และ DB password
- ค่าที่เคยเผยแพร่ในการสนทนาหรือไฟล์เดิมถือว่า compromised ต้อง rotate
- Agent DB password/secret เก็บด้วย Windows DPAPI; server เก็บ Agent secret แบบ encrypted at rest และ key id สำหรับ rotation
- error/log/audit ต้อง redact password, authorization header, cookie, HMAC, enrollment token และ file content

## Authentication and authorization

- password hash ใช้ Argon2id เมื่อ deployment PoC ผ่าน; ถ้า native packaging ไม่ผ่านให้ใช้ Node `scrypt` พร้อม parameter/version ใน hash ห้าม fallback เป็น SHA/MD5
- rate-limit login/signup/enrollment และบันทึก failed attempts โดยไม่เปิดเผยว่าบัญชีมีจริงหรือไม่
- session opaque random token เก็บ hash ใน DB; rotate หลัง login, password/role/status change
- user ใหม่ `pending`; admin activation และการเปลี่ยน role/password ต้อง audit
- authorization ใช้ deny-by-default policy; tenant context มาจาก verified session
- admin destructive action ต้องเลือก facility, re-auth/confirm ตามความเสี่ยง และมี immutable audit event

## Data protection

- TLS ทุก connection: browser, Agent, TiDB, TMT API, object storage
- database user ใช้สิทธิ์เท่าที่จำเป็น ไม่ใช้ root
- upload private, scan/validate format, size/row limits, SHA-256 และ signed URL อายุสั้น
- backup/restore ต้องทดสอบ; ระบุ retention ของ import, export, audit และ staging ก่อน production
- staging/expired token/nonce cleanup เป็น daily job พร้อม idempotency

## Suggested deployment

```text
GitHub private repository
  -> Vercel Next.js deployment
  -> TiDB Cloud Starter/paid cluster
  -> private object storage
  -> GitHub Releases for signed Agent installer
```

TiDB Cloud ต้องสมัคร/สร้างองค์กรและ cluster แยก แม้ใช้ GitHub SSO/Vercel integration ได้ ก่อนใช้ production ต้องตรวจ quota, region, backup, data residency และ SLA

Vercel Hobby ต้องตรวจ terms ว่าเหมาะกับการใช้งานของหน่วยงานหรือไม่ หากไม่เหมาะให้ใช้ paid plan หรือ deploy Next.js บน Node host/VPS ที่รองรับ โดย architecture ไม่ควรผูกกับ Vercel-only API

## Environment notes

- production ไม่มี `JHCIS_DB_*` เพราะ cloud ไม่ต่อ LAN; ค่าเหล่านี้อยู่ใน Agent
- `AGENT_INSTALLER_URL` ต้องเป็น URL ไฟล์ Setup จริงจาก GitHub Release ไม่ใช่ URL หน้าแรกเว็บ
- object storage จำเป็นเมื่อ upload/download เกิน request limit ของ serverless host
- bootstrap admin เปิดครั้งเดียวด้วยรหัสสุ่ม แล้ว disable/delete bootstrap path และบังคับเปลี่ยน password
- ห้ามสร้าง default `admin/admin`

## Release checklist

- migrations run ใน staging clone และ backup/rollback plan พร้อม
- Thai/utf8mb4 round-trip ผ่าน
- tenant isolation/security tests ผ่าน
- Agent enrollment, reconnect, office mismatch และ replay tests ผ่าน
- Excel locked-template contract ผ่าน
- CSP, secure headers, HTTPS redirect, secure cookies, rate limits พร้อม
- secrets ถูกสร้างใหม่และ secret scan ไม่พบค่าเดิม
- monitoring/alert สำหรับ Agent failures, TMT sync, import/export และ auth anomalies พร้อม

