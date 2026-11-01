# Development guide

คู่มือ environment และ workflow กลางสำหรับ Codex, Claude Code และผู้พัฒนา
สถานะปัจจุบันอยู่ที่ [PROJECT_STATUS.md](PROJECT_STATUS.md); business rules และ runbook อยู่ที่ [SPEC.md](SPEC.md) และ [OPERATIONS.md](OPERATIONS.md)

## Repository และ local paths

- GitHub: [TonChaiya/drug-master-platform](https://github.com/TonChaiya/drug-master-platform)
- Primary development path: `C:\laragon\www\16.Drug_Master_Platform`
- Old reference: `C:\laragon\www\15.Drug_Master_Platform-old` — อ่านอ้างอิงกฎได้เท่านั้น ห้าม copy secrets, data หรือ architecture แบบ blind
- `C:\laragon\www\17.data-center-sankamphaeng` ไม่ใช่ส่วนหนึ่งของโปรเจกต์นี้ ห้ามแก้จากงาน Drug Master เว้นแต่ผู้ใช้สั่งชัด

## Technology stack

- Next.js 16, React 19 และ TypeScript strict
- Drizzle ORM, `mysql2` และ Zod
- Tailwind CSS 4 และ Vitest
- TiDB Cloud production; MySQL-compatible database สำหรับ local controlled testing
- Windows Agent เขียนด้วย Python และ package ผ่าน PyInstaller/Inno Setup
- Vercel production; push `main` แล้ว Git integration ทำ auto-deploy

[package.json](../package.json) เป็น source of truth ของ dependency versions และ scripts

## Database environments

### Production

- ใช้ TiDB Cloud ผ่าน environment ของ Vercel runtime
- ห้ามเดาว่า `.env.local` เป็น test: ไฟล์นี้เคยชี้ production มาก่อน
- ก่อน migration หรือ destructive command ต้องยืนยัน host identity, database name และ migration journal ทุกครั้งโดยไม่พิมพ์ secret

### Local controlled testing

- ใช้ Laragon MySQL บน localhost และฐานแยก เช่น `drug_master_agent_test`
- ห้ามสร้าง TiDB test database โดยไม่จำเป็นหรือไม่ได้รับคำสั่ง
- ห้ามใช้ production connection เพื่อความสะดวกในการทดสอบ

## Environment files

- `.env.example` มี placeholders เท่านั้นและ commit ได้
- `.env.local` เป็น local runtime config แต่ต้องตรวจปลายทางก่อนใช้
- production environment จัดการใน Vercel
- temporary production/test env files ห้าม commit และต้องลบหลังใช้
- ห้ามพิมพ์ password, token, connection string หรือ secret ใน chat/log

## Common commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm check
pnpm check:agent-signature
pnpm db:migrate
```

รายละเอียด script ปัจจุบันดู [package.json](../package.json)

## Agent development

- Source: [`agent/windows/`](../agent/windows/)
- Version source: [`agent/windows/version.py`](../agent/windows/version.py) — baseline ปัจจุบัน `1.3.0`
- Build: `agent/windows/build.ps1`
- Installer: `agent/windows/installer/TMTDrugMasterAgent.iss`
- Machine identity: `%ProgramData%\TMTDrugMasterPlatformAgent\installation.json` (ไม่มี secret และต้องคงอยู่ข้าม reinstall)
- Per-user config/credential: `%LOCALAPPDATA%\TMTDrugMasterPlatformAgent\config.json` ป้องกัน secret ด้วย DPAPI
- Global single-instance mutex: `Global\TMTDrugMasterAgentSingleInstance`

`build.ps1` gate ด้วย Ruff pyflakes rules, signature vector test, UI smoke, executable version check และ packaged self-test
จากนั้นจึงสร้าง Inno Setup installer เมื่อพบ `ISCC.exe`; binary สำหรับ release ต้อง sign ก่อนเผยแพร่

## Migration rules

- เปลี่ยน schema ด้วย migration หมายเลขใหม่เท่านั้น ห้ามแก้ migration ที่ applied แล้วแม้แต่คอมเมนต์
- runner บันทึกและตรวจ SHA-256 ใน migration journal
- production migration ต้องยืนยัน environment และ journal ก่อนใช้ runner เดิม
- local migration verification ใช้ Laragon MySQL ได้
- ห้าม rollback production แบบ ad-hoc; ใช้ approved maintenance window และแนวทางใน [OPERATIONS.md](OPERATIONS.md#migration)

## Testing strategy

- เริ่มจาก targeted tests ของ domain ที่เปลี่ยน ไม่ต้อง rerun ทุกอย่างทุก task
- รัน `pnpm typecheck`/`pnpm lint` ตาม scope และ Definition of Done
- เมื่อแตะ Agent protocol ต้องตรวจ HMAC canonical string ฝั่ง Python/Node ด้วย `pnpm check:agent-signature`
- เมื่อแตะ Excel writer ต้องเปิดไฟล์ผลลัพธ์ด้วย Excel/LibreOffice จริง
- ใช้ full suite เมื่อ change มีผลกว้างหรือเป็น release gate

## Deployment workflow

1. commit ใน local หลัง targeted verification/final review
2. push `main` ไป remote เดิม
3. รอ Vercel Git integration auto-deploy; ไม่สร้าง deployment ซ้ำโดยไม่จำเป็น
4. ถ้ามี migration ใหม่ ให้ยืนยัน production DB แล้วรัน migration runner เดิม
5. smoke production เฉพาะ workflow ที่ได้รับผลกระทบ

## AI handoff rules

- อ่าน [PROJECT_STATUS.md](PROJECT_STATUS.md) ก่อนเริ่ม และตรวจ Git HEAD/status จริง
- ให้ repository/deployment evidence เหนือกว่า chat memory
- อัปเดต `PROJECT_STATUS.md` หลัง milestone สำคัญ
- ถ้า business requirement เปลี่ยนให้อัปเดต `SPEC.md`; ถ้า architecture/runtime/security/migration เปลี่ยนให้อัปเดต `OPERATIONS.md`
- อย่าเก็บ transient debug notes หรือ current status ยาว ๆ ใน `AGENTS.md`/`CLAUDE.md`
