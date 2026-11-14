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

## Release version workflow

1. ตรวจ version ปัจจุบันใน `package.json`
2. จัดประเภท PATCH/MINOR/MAJOR ตามกฎใน [AGENTS.md](../AGENTS.md#application-versioning)
3. bump `package.json` สำหรับทุก shipped application change
4. รัน checks ตาม scope และ verify shared footer อ่าน version ใหม่
5. commit/push และอัปเดต `PROJECT_STATUS.md` ด้วย version/checkpoint ที่ตรวจได้

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

การตรวจ migrations 0001-0017 ต้องใช้ MySQL ของ Laragon ที่แยกจาก production/JHCIS และฐานชื่อ exact `drug_master_tmt_v2_test` เท่านั้น ห้ามโหลด `.env.local`:

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
pnpm phase7:reset -- --environment local --env-file <local-test.env> --mode tmt-v2-only --backup-reference <local-backup> --dry-run
pnpm tmt:v2:validate -- --environment local --env-file <local-test.env> --run-id <full-unverified-run-id> --dry-run
```

Validation command จะ persist เฉพาะเมื่อเพิ่ม `--execute --confirm-db <exact test database>` และทุก checkpoint/invariant/GPU/TTMT gate ผ่าน; dry-run เปิด transaction อ่าน evidence แล้ว rollback โดยไม่สร้าง `tmt_run_validations`.

`--mode` เป็นค่าบังคับเพื่อป้องกันการเลือก reset scope โดยปริยาย: ใช้ `tmt-v2-only` เมื่อต้องล้างเฉพาะ TMT v2 และใช้ `full` เฉพาะ cutover reset แบบกว้างที่อนุมัติไว้แล้ว ทั้งสองโหมดยังคง dry-run ถ้าไม่ส่ง `--execute`.

Integration rehearsal ใช้ `NODE_ENV=test`, `ALLOW_DB_INTEGRATION_TESTS=1`, `127.0.0.1` บนพอร์ต Laragon MySQL ที่กำหนด explicit (`3306` หรือ `3307`) และฐาน exact `drug_master_phase7_readiness_test`:

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

Mapping v2 อยู่ที่ hidden route `/mappings/v2` และต้องตั้งทั้ง `TMT_V2_BROWSER_ENABLED=1` และ `TMT_V2_MAPPING_ENABLED=1` ใน process ของ dev server หลัง migrate 0001–0017 บนฐาน local ที่ guard อนุญาตเท่านั้น. Save API ปฏิเสธก่อน query เมื่อ mapping flag ปิด ส่วน TMT Browser API ปฏิเสธก่อน query เมื่อ browser flag ปิด; `/mappings` legacy ยังใช้ `standard_products` ตามเดิม.

รัน targeted contract tests โดยไม่ใช้ `.env.local`:

```powershell
pnpm exec vitest run tests/mapping-v2.test.ts tests/mapping-v2-routes.test.ts tests/tmt-v2-browser-ui.test.ts tests/mapping-lifecycle.test.ts tests/tmt-v2-schema.test.ts
```

การตรวจ clean migration + TMT/TTMT save/review/facility isolation ใช้ฐาน exact `drug_master_mapping_v2_test` บน localhost เท่านั้น และต้องกำหนด `NODE_ENV=test`, `ALLOW_DB_INTEGRATION_TESTS=1` และ `TMT_V2_TEST_*` ครบก่อนรัน `tests/tmt-v2-migration-mysql.test.ts`; guard ปฏิเสธชื่อฐาน/host อื่นและไม่อ่าน `.env.local`.

### Active Standard Release consumers (Phase 2C, local only)

`ACTIVE_STANDARD_RELEASE_ENABLED` เป็น default-off และเปิดด้วย exact `1` เท่านั้น. ใช้ได้เฉพาะ local/test database ที่ migrate ถึง 0018 และมี synthetic approved release/pointer/validation evidence ครบ; ห้ามเปิดกับ production หรือ `.env.local` โดยอาศัยการคาดเดา. เมื่อ flag เปิด consumer ต้อง fail closed หาก pointer/release/dataset/validation ไม่ถูกต้อง และห้าม fallback ไป live standard tables.

Integration test ใช้ฐาน exact `drug_master_mapping_v2_test` ที่ `127.0.0.1:3306`, ต้องยืนยันว่าฐานไม่มีอยู่ก่อน และ test จะสร้าง/ลบเฉพาะฐานที่สร้างในรอบนั้น:

```powershell
$env:NODE_ENV = "test"
$env:ALLOW_DB_INTEGRATION_TESTS = "1"
$env:TMT_V2_TEST_HOST = "127.0.0.1"
$env:TMT_V2_TEST_PORT = "3306"
$env:TMT_V2_TEST_DATABASE = "drug_master_mapping_v2_test"
$env:TMT_V2_TEST_USERNAME = "root"
pnpm exec vitest run tests/phase-2c-mysql.test.ts
```

Test ใช้ synthetic data เพื่อตรวจ approved resolver, dataset isolation, fail-closed, release-aware export hash, stale token/checkpoint safety และ pointer-row locking; ห้ามใช้ฐานที่มีอยู่เดิมหรือ credentials ของ TiDB/JHCIS.

### Phase 2D baseline/release lifecycle (local implementation only)

Pure/unit regression ไม่เชื่อมต่อฐานข้อมูล:

```powershell
pnpm exec vitest run tests/dataset-staging.test.ts tests/standard-release-lifecycle.test.ts tests/standard-release-mysql.test.ts tests/active-release.test.ts tests/export-v2.test.ts
```

Phase 2D MySQL integration harness อยู่ที่ `tests/phase-2d-mysql.test.ts` และปิดไว้ตามค่าเริ่มต้น. Harness ยอมรับเฉพาะ `NODE_ENV=test`, `ALLOW_DB_INTEGRATION_TESTS=1`, `127.0.0.1:3306` และฐาน exact `drug_master_mapping_v2_test`; ก่อนสร้างฐานจะตรวจ MySQL 8.4.3, version comment, `C:\laragon\data\mysql-8.4\`, executable exact ของ Laragon และยืนยันผ่าน `INFORMATION_SCHEMA` ว่าฐานยังไม่มีอยู่. Harness ถือ advisory lock ตลอดรอบ, สร้าง ownership token 256-bit ในฐาน และ cleanup ผ่าน connection ใหม่ได้เฉพาะเมื่อ server identity, database name, lock ownership และ token ตรงกันทั้งหมด.

การรันต้องได้รับอนุมัติ DB integration แยกก่อน และกำหนด environment ต่อ process โดยไม่โหลด `.env.local` หรือ credentials ของ production/JHCIS:

```powershell
$env:NODE_ENV = "test"
$env:ALLOW_DB_INTEGRATION_TESTS = "1"
$env:TMT_V2_TEST_HOST = "127.0.0.1"
$env:TMT_V2_TEST_PORT = "3306"
$env:TMT_V2_TEST_DATABASE = "drug_master_mapping_v2_test"
$env:TMT_V2_TEST_USERNAME = "drug_master_phase2d_test"
$env:TMT_V2_TEST_PASSWORD = "<secure-process-local-random-secret>"
pnpm exec vitest run tests/phase-2d-mysql.test.ts
```

ใช้ dedicated account ที่มีสิทธิ์เฉพาะ `drug_master_mapping_v2_test.*`; ห้ามใช้ root เป็น integration-test account และห้ามเก็บ password ในไฟล์หรือ shell profile. ห้ามรันหากฐานชื่อนี้มีอยู่ก่อน และห้ามเปิด DB opt-in ให้ full suite. Harness ใช้ synthetic data เพื่อตรวจ migration 0001–0018, bounded resume/source mutation, evidence rejection, concurrent writer/publish, shared pointer lock, atomic publish, pointer-only rollback และ dataset immutability เท่านั้น.

ผลยืนยัน local วันที่ 2026-11-14: `tests/phase-2d-mysql.test.ts` ผ่าน 9/9 บน Laragon MySQL 8.4.3 ด้วย dedicated account รวม fresh/0017→0018 journal transition, final schema keys/FKs และ dataset isolation; cleanup ยืนยันว่าฐานถูกลบ, advisory lock ว่าง, ไม่มี connection ของ test user และ database inventory เดิมไม่เปลี่ยน. ผลนี้ไม่อนุญาต production migration/copy/publish/flag activation; Production ต้องมี disposable TiDB evidence, backup/restore evidence และ approved maintenance plan แยก.

Guarded Migration 0018 executor ทดสอบด้วย `tests/migrate-0018-guarded.test.ts`; DB case ปิดตาม default และใช้ Phase 2D harness/dedicated account เดิมเท่านั้น. Unit cases ครอบคลุม identity/hash/journal/partial-schema/confirmation/maintenance/TLS/redaction/partial-DDL refusal. Local integration ต้องเริ่มจาก exact journal 0001–0017, รัน 0018 ทีละ statement, ตรวจ schema แล้วจึงบันทึก journal; test database ต้องถูก cleanup ผ่าน ownership token/advisory lock เดิม.

```powershell
pnpm exec vitest run tests/migrate-0018-guarded.test.ts
```

ห้ามใช้ `tests/tmt-v2-migration-mysql.test.ts` เป็น executor acceptance test เพราะ test เดิมบังคับ root และ cleanup ผ่าน `USE mysql`; acceptance ของ executor ใช้ dedicated-account harness ข้างต้น. การใช้ command จริงต้องระบุ `--env-file` ที่อยู่นอก repository, operator UUID และ reason; Production execute ยังต้องมี confirmation/hash/maintenance approval ครบตาม [OPERATIONS.md](OPERATIONS.md#migration).

### Dataset Release CLI (default dry-run)

CLI โหลดเฉพาะไฟล์ environment ที่ระบุชัดเจนและไม่โหลด `.env.local` โดยปริยาย:

```powershell
pnpm dataset:release -- preflight --environment local --env-file <explicit-test.env>
pnpm dataset:release -- status --environment local --env-file <explicit-test.env> --release-id <uuid>
pnpm dataset:release -- baseline --environment local --env-file <explicit-test.env> --dataset-id <uuid> --source TMT --source-version <version> --tmt-sync-run-id <uuid> --expected-active-release-id none --actor-user-id <uuid> --reason "reviewed baseline"
```

คำสั่ง mutation (`baseline`, `resume`, `validate`, `approve`, `publish`, `rollback`) ไม่เขียนข้อมูลหากไม่มี `--execute`; ทุก mutation ต้องระบุ expected active release และ execution ต้องมี `--confirm-db` กับ confirmation exact `EXECUTE <command> <target-uuid>`. Unit tests ใช้ fake dependencies เท่านั้น:

```powershell
pnpm exec vitest run tests/dataset-release-cli.test.ts
```

ห้ามใช้ CLI กับ Production เพียงเพราะ dry-run หรือ MySQL integration ผ่าน; Migration 0018 hash ปัจจุบันคือ `95d21cae6ded4f5f24b05f9caaab9338599f404ca904a404940001547b02c57e` และยังต้องผ่าน disposable TiDB DDL/journal/locking test, backup/restore rehearsal, storage review และ operator approval แยก.

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
