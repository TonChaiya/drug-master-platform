# TMT Drug Master Platform

ระบบจับคู่รายการยาของสถานบริการกับรหัสมาตรฐาน TMT/TTMT แล้วส่งออกเป็นไฟล์ DrugCat

รายการยาถูกดึงจาก JHCIS ในวง LAN ของแต่ละสถานบริการโดย Windows Agent ที่ติดตั้งไว้ที่เครื่องนั้น
แล้วส่งขึ้นฐานข้อมูลกลางบน TiDB Cloud ผ่าน HTTPS ขาออกอย่างเดียว — เว็บบน cloud ไม่เคยต่อเข้า LAN โดยตรง

```text
JHCIS (LAN, read-only)  →  Windows Agent  →[HTTPS + HMAC]→  Next.js  →  TiDB Cloud
                                                               ↕
                                                            TMT API
```

## เอกสารปัจจุบัน

| ไฟล์ | เนื้อหา |
|---|---|
| [AGENTS.md](AGENTS.md) | กฎร่วมสำหรับ Codex, Claude Code และ coding agent อื่น |
| [CLAUDE.md](CLAUDE.md) | entrypoint สั้นสำหรับ Claude Code ไปยังเอกสารกลาง |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | สถานะ production, checkpoint และ backlog ล่าสุด |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | environment, คำสั่ง build/test และ workflow พัฒนา |
| [docs/SPEC.md](docs/SPEC.md) | ระบบต้องทำอะไร: กฎธุรกิจ, แบบจำลองข้อมูล, TMT API, สัญญาไฟล์ DrugCat |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | ระบบทำงานอย่างไร: สถาปัตยกรรม, Agent protocol, ความปลอดภัย, การขึ้นระบบ |

## Roadmap และประวัติการออกแบบ

| ที่อยู่ | เนื้อหา |
|---|---|
| [docs/UNIFIED_SYSTEM_IMPROVEMENT_PLAN.md](docs/UNIFIED_SYSTEM_IMPROVEMENT_PLAN.md) | roadmap หกระยะฉบับตั้งต้น เก็บไว้เป็นประวัติ; ไม่ใช่สถานะปัจจุบัน |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | แผน implementation ตามวันที่ |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | design/discovery records ตามวันที่ |

สถานะปัจจุบันให้ยึด `PROJECT_STATUS.md`; ข้อกำหนดถาวรให้ยึด `SPEC.md` และ runbook ให้ยึด `OPERATIONS.md`
ข้อความสถานะในเอกสารประวัติสะท้อนเวลาที่เขียนและอาจถูกงานภายหลังแทนที่

## เริ่มใช้งาน

คำสั่งด้านล่างสำหรับ local development เท่านั้น. ตรวจว่า environment ชี้ฐานทดสอบที่แยกจาก Production, ไม่ใช่ port 3333 และไม่ใช่ `jhcisdb`.

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

เส้นทางหลักคือ Dashboard → เชื่อมต่อ JHCIS → Standards → Drug Catalog → [จับคู่รายการยา](docs/SPEC.md#3-ลำดับเตรียมข้อมูลและ-map) (`/mappings`) → ส่งออก DrugCat `.xls`. ผู้ดูแลจัดการสถานบริการ บัญชี Agent และงานมาตรฐานใน Admin.

Production บน Vercel/TiDB Cloud ใช้ independent accepted dataset สำหรับ TMT และ Excel import แยกสำหรับ TTMT. Combined Dataset Release ต้องได้รับอนุมัติแยกก่อนเปิดใช้.

รายการ hardening และงานที่ยังต้องติดตามไม่ได้ถือว่าผ่านทั้งหมด ดูสถานะที่ตรวจล่าสุดใน
[Phase 6 closure checkpoint](docs/PROJECT_STATUS.md#phase-6-verification-and-closure) และ runbook/checklist ใน [docs/OPERATIONS.md](docs/OPERATIONS.md)
