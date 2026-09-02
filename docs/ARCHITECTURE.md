# สถาปัตยกรรม Next.js

## ภาพรวม

```text
Browser
  -> Next.js App Router (UI + Route Handlers)
       -> Application services / authorization policy
            -> TiDB Cloud (central data)
            -> Private object storage (imports/exports)
            -> TMT API (server-to-server)

Windows Tray Agent at facility
  -> read-only JHCIS in LAN
  -> outbound HTTPS + signed requests
  -> Next.js Agent API
```

GitHub เก็บ source และ workflow; Vercel เป็นตัวอย่าง runtime; TiDB เป็นฐานข้อมูลแยก ไม่ใช่ฐานที่ GitHub ให้มา

## โครงสร้างโค้ดเป้าหมาย

```text
src/
  app/
    (auth)/
    (dashboard)/
    api/v1/
  modules/
    auth/
    facilities/
    jhcis/
    standards/
    drug-catalog/
    mappings/
    exports/
    agent/
  db/
    schema/
    migrations/
    queries/
  lib/
    authorization/
    validation/
    crypto/
agent/
  windows/              # source only; binaries publish to GitHub Releases
tests/
  unit/
  integration/
  e2e/
references/
  templates/            # approved blank template only
docs/
```

## Boundaries

- React components ห้าม query DB โดยตรง ให้ผ่าน server-side use case/service
- Route Handler ทำเพียง auth, validation, rate/size limit, เรียก use case และแปลง response
- repository ทุกตัวที่ถือข้อมูลสถานบริการต้องรับ `TenantContext` ที่สร้างจาก session เท่านั้น
- admin impersonation/เลือก facility เป็น explicit context พร้อม audit ไม่แก้ session owner
- TMT API และ Excel parsing เป็น adapter แยกจาก business rules เพื่อ test ด้วย fixture ได้
- งาน import ขนาดใหญ่ใช้ upload ตรงเข้า object storage แล้วสร้าง background/import job; ห้ามส่งไฟล์ใหญ่ผ่าน Vercel function

## Hosting constraints

- เว็บบน cloud เปิด connection เข้า LAN/JHCIS ไม่ได้อย่างปลอดภัย จึงใช้ Agent outbound เท่านั้น
- function filesystem เป็น ephemeral; ห้ามใช้เป็นที่เก็บ session, template, upload หรือ export ระยะยาว
- ออกแบบ Agent batch ให้ต่ำกว่าข้อจำกัด payload ของ provider (เป้าหมายไม่เกิน 1 MiB ต่อ request)
- cron ไม่ใช่ช่องสั่ง Agent หลัก; Agent poll คำสั่งเป็นระยะ และ cron ใช้ cleanup/daily maintenance
- ตรวจเงื่อนไข Vercel plan ก่อน production โดยเฉพาะการใช้งานของหน่วยงาน ไม่ถือว่า Hobby เหมาะอัตโนมัติ

## Technology decisions

- MySQL-compatible SQL แบบ portable: ไม่ใช้ trigger, stored procedure หรือ event
- เริ่มค้นหาด้วย normalized columns + indexes; อย่าผูก MVP กับ FULLTEXT เพราะความพร้อมของ TiDB ต่างตาม region/plan
- เวลาเก็บ UTC และแสดง `Asia/Bangkok`
- charset/collation ต้องรองรับ `utf8mb4` ภาษาไทย
- ใช้ opaque DB-backed session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) และ rotate หลัง login/role change
- ใช้ object storage private พร้อม signed download URL อายุสั้น

## Non-goals ระยะแรก

- ไม่เชื่อม JHCIS โดยตรงจาก Vercel
- ไม่ migrate ข้อมูลจริงจากฐานเก่า
- ไม่รองรับ PRODUCTCAT 2/4 จนมี workflow concept และ SPECPREP ที่ยืนยันแล้ว
- ไม่ใช้ TMT code เดิมจาก JHCIS เพื่อ auto-approve

