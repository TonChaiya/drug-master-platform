# TMT Drug Master Platform

ระบบจับคู่รายการยาของสถานบริการกับรหัสมาตรฐาน TMT/TTMT แล้วส่งออกเป็นไฟล์ DrugCat

รายการยาถูกดึงจาก JHCIS ในวง LAN ของแต่ละสถานบริการโดย Windows Agent ที่ติดตั้งไว้ที่เครื่องนั้น
แล้วส่งขึ้นฐานข้อมูลกลางบน TiDB Cloud ผ่าน HTTPS ขาออกอย่างเดียว — เว็บบน cloud ไม่เคยต่อเข้า LAN โดยตรง

```text
JHCIS (LAN, read-only)  →  Windows Agent  →[HTTPS + HMAC]→  Next.js  →  TiDB Cloud
                                                               ↕
                                                            TMT API
```

## เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| [AGENTS.md](AGENTS.md) | ข้อตกลงการทำงาน กฎ ponytail และข้อผิดพลาดของระบบเดิมที่ห้ามทำซ้ำ |
| [docs/SPEC.md](docs/SPEC.md) | ระบบต้องทำอะไร: กฎธุรกิจ, แบบจำลองข้อมูล, TMT API, สัญญาไฟล์ DrugCat |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | ระบบทำงานอย่างไร: สถาปัตยกรรม, Agent protocol, ความปลอดภัย, การขึ้นระบบ |

## เริ่มใช้งาน

```bash
pnpm install
cp .env.example .env.local
pnpm keys:generate      # คัดลอกค่าที่ได้ไปใส่ .env.local
pnpm db:migrate
pnpm bootstrap:admin    # รหัสผ่านสุ่ม แสดงครั้งเดียว
pnpm dev                # http://localhost:3000
```

`.env.local` ต้องมีอย่างน้อย `DB_*`, `SESSION_SECRET` และ `APP_ENCRYPTION_KEY`
ถ้า `pnpm` ไม่อยู่ใน PATH: `corepack enable pnpm`

รายละเอียดทั้งหมดอยู่ใน [docs/OPERATIONS.md](docs/OPERATIONS.md#4-การติดตั้งและใช้งาน)

## โครงสร้าง

```text
src/
  app/(auth)         เข้าสู่ระบบ / สมัครสมาชิก
  app/(dashboard)    ภาพรวม, เชื่อมต่อ JHCIS, มาตรฐาน, Drug Catalog, จับคู่, ส่งออก, ผู้ดูแลระบบ
  app/api/v1         REST API รวม Agent protocol
  modules/           business logic แยกตามโดเมน
  lib/excel/         ตัวอ่าน/เขียน .xls (BIFF8) และ .xlsx เขียนเอง ไม่มี dependency ภายนอก
  lib/authorization/ facility scope ที่ทุก query ต้องผ่าน
  db/                Drizzle schema และ SQL migrations
agent/windows/       Windows Agent (Python) เผยแพร่ผ่าน GitHub Releases
references/templates/ แม่แบบ DrugCat เปล่าที่อนุมัติแล้ว ใช้อ้างอิงรูปแบบไฟล์
```

## สถานะ

ใช้งานได้ครบทั้งสายงานแล้ว: ดึงยาจาก JHCIS → ซิงก์มาตรฐาน → นำเข้า Drug Catalog → จับคู่ → ส่งออก `.xls`

**ยังไม่ควร deploy เป็น production** จนกว่า checklist ใน
[docs/OPERATIONS.md](docs/OPERATIONS.md#5-checklist-ก่อนขึ้น-production) จะผ่านครบ
โดยเฉพาะการทดสอบกับ JHCIS จริง, การเปิดไฟล์ส่งออกด้วย Excel บน Windows จริง และการ rotate secrets
