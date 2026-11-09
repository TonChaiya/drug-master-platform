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

สำหรับ rate-limit cleanup ให้ตั้ง `CRON_SECRET` เฉพาะใน environment ทดสอบและเรียก route ด้วย bearer เดียวกัน ห้ามใช้ค่า production
รัน targeted tests ด้วย:

```bash
pnpm exec vitest run tests/rate-limit-cleanup.test.ts tests/rate-limit-cleanup-route.test.ts tests/rate-limit-cleanup-mysql.test.ts
```

### TMT/TTMT Data Model v2 foundation

Parser และ schema contracts ใช้ synthetic fixtures เท่านั้น:

```bash
pnpm exec vitest run tests/tmt-api-client.test.ts tests/tmt-v2-schema.test.ts
```

การตรวจ migrations 0001-0016 ต้องใช้ MySQL ของ Laragon ที่แยกจาก production/JHCIS และฐานชื่อ exact `drug_master_tmt_v2_test` เท่านั้น ห้ามโหลด `.env.local`:

```powershell
$env:NODE_ENV = "test"
$env:ALLOW_DB_INTEGRATION_TESTS = "1"
$env:TMT_V2_TEST_HOST = "127.0.0.1"
$env:TMT_V2_TEST_PORT = "3307"
$env:TMT_V2_TEST_DATABASE = "drug_master_tmt_v2_test"
$env:TMT_V2_TEST_USERNAME = "root"
pnpm exec vitest run tests/tmt-v2-migration-mysql.test.ts
```

DB integration tests อื่นต้องตั้ง `NODE_ENV=test`, `ALLOW_DB_INTEGRATION_TESTS=1` และ `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_DATABASE` โดยตรง ฐานต้องอยู่ที่ `localhost`/`127.0.0.1` และชื่อตรง pattern `drug_master_*test` เท่านั้น หากไม่ opt-in test จะ skip; หาก opt-in แต่ target ไม่ผ่าน guard จะ fail ก่อนสร้าง connection และไม่มี fallback ไป `.env.local`

Migration test guard host/port/database/user, สร้างฐานสะอาด, ตรวจ journal/hash/schema/rerun แล้ว drop เฉพาะฐานทดสอบเมื่อจบ

> Incident note (Phase 2): During Phase 2 verification, a DB-backed baseline test inherited `.env.local`. The test completed cleanup, production cleanup was later verified read-only, and a fail-closed integration-test DB guard was added.

### TMT v2 sync engine (Phase 3, local only)

Engine อยู่ใน `src/modules/tmt/` และไม่มี production route/cron เรียกใช้ การทดสอบ persistence/invariant ต้องใช้ local DB ชื่อ exact `drug_master_tmt_v2_sync_test` ที่ migrate ถึง 0015:

```powershell
$env:NODE_ENV = "test"
$env:ALLOW_DB_INTEGRATION_TESTS = "1"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "3307"
$env:DB_USERNAME = "root"
$env:DB_DATABASE = "drug_master_tmt_v2_sync_test"
pnpm exec vitest run tests/tmt-v2-persistence-mysql.test.ts tests/tmt-v2-invariants.test.ts
```

Controlled live backfill ต้องเพิ่ม `ALLOW_TMT_LIVE_SYNC=1` และ `TMT_V2_SYNC_CREDENTIAL_FILE` แบบ explicit เท่านั้น Harness อ่านเฉพาะ TMT credential เข้า memory; ถ้า env credential ว่าง จะอ่าน encrypted `app_settings.tmt_api` จาก production ด้วย SELECT-only connection แล้วปิดก่อนเขียน local DB ห้ามพิมพ์ secret/token และห้ามใช้คำสั่งนี้กับ DB ที่ guard ไม่ยอมรับ:

```powershell
$env:ALLOW_TMT_LIVE_SYNC = "1"
$env:TMT_V2_SYNC_CREDENTIAL_FILE = (Resolve-Path ".env.local").Path
pnpm exec vitest run tests/tmt-v2-live-sync.test.ts --reporter=verbose
```

Live harness ล้างเฉพาะตาราง `tmt_*` ใน local test DB เพื่อทำ full backfill ใหม่; ห้ามใช้กับ production และไม่แตะ `jhcisdb`

### Phase 7A cutover readiness (local rehearsal only)

ทุก CLI ต้องรับ `--env-file` แบบ explicit และไม่ fallback ไป `.env.local`. เป้าหมาย local ต้องเป็น localhost และชื่อ `drug_master_*test`; production fingerprint/confirmation/maintenance guards ถูกทดสอบแยก แต่ห้าม execute production ใน Phase 7A.

```powershell
pnpm phase7:maintenance -- --environment local --env-file <local-test.env> --status
pnpm tmt:v2:sync -- --environment local --env-file <local-test.env> --mode full --dry-run
pnpm ttmt:v2:import -- --environment local --env-file <local-test.env> --file <approved-fixture.xls> --version <version> --dry-run
pnpm phase7:preflight -- --environment local --env-file <local-test.env> --master-ttmt <approved-fixture.xls>
pnpm phase7:reset -- --environment local --env-file <local-test.env> --backup-reference <local-backup> --dry-run
```

Integration rehearsal ใช้ `NODE_ENV=test`, `ALLOW_DB_INTEGRATION_TESTS=1`, `127.0.0.1:3307` และฐาน exact `drug_master_phase7_readiness_test`:

```powershell
pnpm exec vitest run tests/phase7-readiness-mysql.test.ts
```

fixture ใน test สร้างจาก known legacy MasterTTMT column contract เท่านั้น ไม่ใช่ production MasterTTMT file และห้ามนำไปใช้ cutover.

### TMT Browser v2 (Phase 4, local only)

Browser อยู่ที่ hidden route `/admin/tmt-v2` และ default-off. ใช้ fixture DB แยกชื่อ exact `drug_master_tmt_v2_browser_test` ที่ localhost เท่านั้น; ห้ามโหลด `.env.local` หรือใช้ `jhcisdb`:

```powershell
$env:NODE_ENV = "test"
$env:ALLOW_DB_INTEGRATION_TESTS = "1"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "3307"
$env:DB_USERNAME = "root"
$env:DB_DATABASE = "drug_master_tmt_v2_browser_test"
pnpm exec vitest run tests/tmt-v2-browser-mysql.test.ts tests/tmt-v2-browser-routes.test.ts tests/tmt-v2-browser-ui.test.ts
```

สำหรับ visual review local เท่านั้น ให้ตั้ง `TMT_V2_BROWSER_ENABLED=1` ใน process ของ dev server หลัง migrate 0001–0015 และโหลด fixture แล้ว เมื่อไม่ตั้งหรือค่าไม่ใช่ `1` page/API ต้องไม่ query ตาราง v2.

### Mapping v2 (Phase 5, local only)

Mapping v2 อยู่ที่ hidden route `/mappings/v2` และต้องตั้งทั้ง `TMT_V2_BROWSER_ENABLED=1` และ `TMT_V2_MAPPING_ENABLED=1` ใน process ของ dev server หลัง migrate 0001–0016 บนฐาน local ที่ guard อนุญาตเท่านั้น. Save API ปฏิเสธก่อน query เมื่อ mapping flag ปิด ส่วน TMT Browser API ปฏิเสธก่อน query เมื่อ browser flag ปิด; `/mappings` legacy ยังใช้ `standard_products` ตามเดิม.

รัน targeted contract tests โดยไม่ใช้ `.env.local`:

```powershell
pnpm exec vitest run tests/mapping-v2.test.ts tests/mapping-v2-routes.test.ts tests/tmt-v2-browser-ui.test.ts tests/mapping-lifecycle.test.ts tests/tmt-v2-schema.test.ts
```

การตรวจ clean migration + TMT/TTMT save/review/facility isolation ใช้ฐาน exact `drug_master_mapping_v2_test` บน localhost เท่านั้น และต้องกำหนด `NODE_ENV=test`, `ALLOW_DB_INTEGRATION_TESTS=1` และ `TMT_V2_TEST_*` ครบก่อนรัน `tests/tmt-v2-migration-mysql.test.ts`; guard ปฏิเสธชื่อฐาน/host อื่นและไม่อ่าน `.env.local`.

### Catalog/Export v2 (Phase 6, local only)

Catalog และ Export v2 แยก flag และ default-off. ใช้เฉพาะ local/test process ที่ migrate ถึง 0016 แล้ว:

```powershell
$env:TMT_V2_CATALOG_ENABLED = "1"
$env:TMT_V2_EXPORT_ENABLED = "1"
```

Targeted pure tests ไม่ต้องใช้ฐานข้อมูล:

```powershell
pnpm exec vitest run tests/mapping-v2-consumer.test.ts tests/export-v2.test.ts tests/mapping-summary.test.ts tests/tmt-v2-browser.test.ts
```

Local E2E ต้องใช้ Laragon MySQL ที่ `127.0.0.1` และฐาน exact `drug_master_export_v2_test` เท่านั้น โดยกำหนด env ต่อ process แบบ explicit, ห้ามโหลด `.env.local`, ห้ามใช้ `jhcisdb` และต้อง opt-in integration guard:

```powershell
$env:NODE_ENV = "test"
$env:ALLOW_DB_INTEGRATION_TESTS = "1"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "3307"
$env:DB_USERNAME = "root"
$env:DB_PASSWORD = ""
$env:DB_DATABASE = "drug_master_export_v2_test"
$env:TMT_V2_CATALOG_ENABLED = "1"
$env:TMT_V2_EXPORT_ENABLED = "1"
pnpm exec vitest run tests/export-v2-mysql.test.ts --reporter=verbose
```

E2E สร้างและลบเฉพาะฐานทดสอบดังกล่าว ตรวจ full/delta/checkpoint/rollback/stale preview/invalidation/tenant isolation และเขียนไฟล์จริงไป temp directory. ทุกครั้งที่แตะ writer หรือ row contract ต้องอ่านไฟล์กลับแบบ programmatic และเปิดไฟล์ผลลัพธ์ด้วย Excel/LibreOffice จริงเพื่อตรวจหัว 22 ช่อง, Thai text, leading zeroes, NDC24, วันที่, ISED และ PRODUCTCAT.

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
