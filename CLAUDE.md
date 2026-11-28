# Claude Code entrypoint

โปรเจกต์นี้ใช้ shared instructions ร่วมกับ coding agent ทุกตัว ไม่ได้มี source of truth แยกสำหรับ Claude Code

อ่านตามลำดับ:

1. [AGENTS.md](AGENTS.md) — กฎการทำงานร่วม
2. [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) — สถานะและ checkpoint ล่าสุด
3. [docs/SPEC.md](docs/SPEC.md) — business/system requirements ของ domain ที่จะแก้
4. [docs/OPERATIONS.md](docs/OPERATIONS.md) — architecture, runtime, security และ migrations
5. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local environment, build, test และ deploy workflow
6. สำหรับงาน TMT ให้อ่าน [docs/TMT_ARCHITECTURE_REPLACEMENT_PLAN.md](docs/TMT_ARCHITECTURE_REPLACEMENT_PLAN.md) และคู่มือ `tmtapi_manual.pdf` (ไฟล์อ้างอิงในเครื่อง) จาก root ของโปรเจกต์

`CLAUDE.md` เป็นเพียง compatibility entrypoint; ห้าม duplicate หรือ override กฎใน `AGENTS.md`
เอกสาร roadmap/design ที่ระบุว่า historical ใช้อธิบายที่มาเท่านั้น; สถานะปัจจุบันต้องยึดชุด canonical ข้างต้น
หลักฐานการปิดงานหกระยะและขอบเขตที่ยังไม่ได้ตรวจอยู่ใน [Phase 6 closure](docs/PROJECT_STATUS.md#phase-6-verification-and-closure)
คง `.claude/launch.json` เป็น launch configuration ของโปรเจกต์
