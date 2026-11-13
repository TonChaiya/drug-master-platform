# Project status

เอกสารนี้เป็น handoff/current-state กลาง ไม่ใช่ business specification หรือ runbook
ข้อกำหนดถาวรอยู่ใน [SPEC.md](SPEC.md) และการปฏิบัติระบบอยู่ใน [OPERATIONS.md](OPERATIONS.md)

## Current production baseline

- Repository: [TonChaiya/drug-master-platform](https://github.com/TonChaiya/drug-master-platform)
- Branch: `main`
- Previous UX/version-policy checkpoint: `75f21f29a018cd82d9fd400f92f3f5efabc91a02`
- Current application version: `0.7.0`
- Hosting: Vercel production deployed through Git integration
- Production database: TiDB Cloud
- Latest applied migration: `0017_tmt_run_validations.sql`
- Windows Agent baseline: `1.3.0`

## Unified system improvement handoff

- Canonical controlled-improvement plan: [UNIFIED_SYSTEM_IMPROVEMENT_PLAN.md](UNIFIED_SYSTEM_IMPROVEMENT_PLAN.md)
- Status: Phase 2D local implementation และ isolated MySQL verification เสร็จแล้วสำหรับ release `0.7.0`; Production ยังคงใช้ legacy live dataset path เพราะ feature flag ปิดอยู่ และ production migration/baseline/publish ยังไม่ได้รับอนุมัติ.
- The plan preserves the current acceptance constraints: one user-facing system, compact responsive UI, application version only in the shared footer, and no production/schema/migration/deploy changes without separate approval.

## Phase 2C completion checkpoint

- เพิ่ม Active Standard Release resolver จาก schema 0018 โดยใช้ pointer key กลาง `active-standard-release`; เปิดใช้เฉพาะเมื่อ `ACTIVE_STANDARD_RELEASE_ENABLED=1` และค่า default เป็น off.
- เมื่อ flag เปิด Search/RegNo/Graph/Detail, TTMT Search, Mapping v2, Readiness และ Export v2 อ่าน TMT/TTMT จาก approved release เดียวกัน; missing/invalid release ต้อง fail closed และห้าม fallback ไป live standard tables.
- Export preview hash ผูกกับ release ID; download lock pointer row ภายใน transaction ก่อน resolve/build. Release switch ทำให้ token stale แม้ output เหมือนเดิม และ stale request ห้าม consume token หรือเลื่อน delta checkpoint.
- Local Laragon verification วันที่ 2026-11-13: migration integration 7/7, Phase 2C MySQL integration 4/4, full regression 270 passed / 52 guarded skips, typecheck/lint/diff-check ผ่าน. ฐาน `drug_master_mapping_v2_test` ถูกสร้างจากศูนย์ด้วย synthetic data และยืนยันว่าถูกลบหลังทดสอบ.
- ไม่มีการ apply migration, เปลี่ยน active pointer, publish release, เปิด feature flag หรือแก้ production ใน Phase 2C.

## Phase 2D local implementation checkpoint

- เพิ่ม resumable copy-only baseline preparation แบบ bounded batch จาก live TMT/TTMT ไป schema 0018 โดยตรวจ source snapshot ก่อน/หลัง, manifest count/hash และ source version/run-import linkage; writer lock candidate row ร่วม transaction เพื่อไม่ให้เขียนต่อหลัง validation.
- Release workflow แยก candidate validation → explicit approval → atomic publish; publish/rollback ใช้ pointer key `active-standard-release`, lock pointer row แบบเดียวกับ Phase 2C export และใช้ expected active release ID ป้องกัน concurrent switch.
- Validation รักษา assurance `validated_unverified`, ตรวจ evidence/checkpoint/run/import linkage, manifests, latest-date RegNo conflicts, dataset-scoped TMT invariants/GPU 764169 และ provenance ของ versioned rows. Rollback เปลี่ยน pointer เท่านั้น ไม่ copy/delete dataset rows และไม่แก้ Mapping, Catalog หรือ Export checkpoints.
- Isolated Laragon MySQL verification วันที่ 2026-11-13 ผ่าน 8/8 ด้วย synthetic fixtures และ dedicated account: migration 0001–0018, bounded resume/source mutation, deterministic manifests, evidence/RegNo gates, explicit approval, concurrent publish, shared pointer lock, atomic publish, pointer-only rollback, immutability และ audit evidence. Cleanup ยืนยันฐานเป้าหมายหาย, lock ว่าง, ไม่มี test-user connection และ database inventory เดิมไม่เปลี่ยน.
- Full non-DB verification ปิด DB opt-in ผ่าน 308 tests / 60 guarded skips; typecheck, lint และ diff-check ผ่าน. ไม่มี production access, production migration, baseline copy, publish/rollback หรือ feature-flag activation.

## Major completed areas

- JHCIS Agent enrollment, signed heartbeat/command polling และ atomic sync
- stable ProgramData installation identity, canonical re-enrollment และ duplicate protection โดยไม่ auto-merge จาก MAC
- Agent admin disable, supersede และ safe delete พร้อม Registration/Presence/Credential/JHCIS แยกสถานะ
- Drug Catalog verified snapshot lifecycle และ reconcile โดยเก็บ snapshot/mapping history เดิม
- Mapping lifecycle `pending`, `needs_review`, `mapped` และ review acknowledgement ที่ stale เมื่อ state เปลี่ยน
- Dashboard/Admin summary ใช้ Mapping lifecycle เดียวกับ worklist และแยก export-ready ตาม standard validity
- Admin summary แยกบัญชี active/pending/disabled และ Agent Registration/Presence/Credential/JHCIS ตามสถานะจริง
- Admin workspace ปรับ UX แบบ compact แล้ว: filter สถานบริการ/บัญชีทำงานฝั่ง client และ configuration panels แสดง status ก่อนเปิดแก้ไข
- full/delta export checkpoint ต่อ facility และ mapping version; preview token ใช้ครั้งเดียวและมี expiry
- facility-scoped authorization จาก verified session
- shared persistent rate limiting สำหรับ login/signup/Agent enrollment โดยไม่เก็บ raw IP
- TMT sync/enrichment และ TTMT file import พร้อม version history

Migration สำคัญล่าสุด:

- `0010_mapping_export_checkpoints.sql` — export delta checkpoints และ preview snapshot
- `0011_mapping_review_acknowledgements.sql` — current review acknowledgement ต่อ mapping
- `0012_agent_identity_management.sql` — Agent identity, heartbeat/JHCIS telemetry และ targeted re-enrollment
- `0013_shared_rate_limits.sql` — shared fixed-window counters สำหรับ public endpoints
- `0014_tmt_data_model_v2.sql` / `0015_ttmt_data_model_v2.sql` — TMT/TTMT v2 persistence
- `0016_mapping_v2_identity.sql` — source-aware mapping identity
- `0017_tmt_run_validations.sql` — persisted evidence สำหรับ validated-unverified readiness

## Verified production state

- production migrations `0010`–`0017` applied แล้ว
- login/signup/Agent enrollment rate limiter ผ่าน controlled production verification และไม่พบ fail-open/error
- expired rate-limit bucket cleanup เปิดใช้บน production ผ่าน Vercel Cron เวลา `30 19 * * *` UTC และ controlled invocation ผ่านโดยไม่แตะ business tables
- Agent 1.3.0 fresh enrollment production ผ่านสำหรับ facility `05957`
- หลัง Agent cleanup มีหนึ่ง installation และหนึ่ง active credential สำหรับเครื่องที่ตรวจ
- actual `office.offid` validation, MAC/IP/version telemetry และ heartbeat/JHCIS connected ผ่านการตรวจ
- Mapping lifecycle/review production smoke ผ่าน
- Export delta checkpoint flow ผ่าน controlled production verification
- หน้า Agent `/jhcis` และ status model ผ่าน production smoke

ข้อมูลข้างต้นไม่ใช่คำรับรองว่า security/operations checklist ทุกข้อผ่าน ดูรายการค้างด้านล่างและ [OPERATIONS.md](OPERATIONS.md#5-production-verification-checklist)

## Current TMT/TTMT production state

- TMT/TTMT Data Model v2 Phase 1–7 เสร็จแล้วและ production cutover เสร็จสมบูรณ์
- TMT production dataset ปัจจุบันพร้อมใช้งานภายใต้ assurance `validated_unverified`; **ห้ามเรียกว่า verified**
- successful TMT full-unverified run: `ae95225a-4d58-47f9-a170-a5ccc6cac7b9`
- persisted validation policy: `validated-unverified-v1`
- successful TTMT import: `46ac7956-4a52-43da-8f0a-c54fa392a70c`
- เวอร์ชันข้อมูล TTMT: `20261001`
- legacy `standard_*`/`standard_products` API และข้อมูลยังคงอยู่เพื่อ compatibility แต่ไม่ใช่แหล่งมาตรฐานหลักของ production workflow

## Current UX workflow

- UX-1 checkpoint: `e13e5530d40db3603955743ec3999207ac5e1aae`
- UX-2 checkpoint: `e60cda79c997622834d6562e1a1c72ff2efabe40`
- workflow ปัจจุบัน: JHCIS → Standards Hub → Drug Catalog → การจับคู่รายการยา → Export
- navigation หลักชี้ไปการจับคู่รายการยา; `/mappings` redirect ไป `/mappings/v2` เมื่อ feature flag ภายในเปิด
- `/standards` ไม่แสดง legacy standards sync ใน normal workflow เพื่อไม่ให้ผู้ใช้เข้าใจว่าเป็นข้อมูล TMT ปัจจุบัน
- `/admin` แสดง current TMT v2 readiness, latest run, bounded run/checkpoint history และ current TTMT v2 import history เฉพาะผู้ดูแลระบบ
- การเริ่มหรือ resume TMT sync ยังเป็น CLI-only เพราะต้องยืนยัน environment/database, mode และ production guard สำหรับงานที่อาจใช้เวลานาน; Admin ไม่เริ่มงานนี้จาก web request
- Admin สามารถนำเข้าไฟล์ MasterTTMT `.xls`/`.xlsx` ด้วย current TTMT v2 importer เท่านั้น; route ใช้ `requireAdmin()` และไม่เรียก legacy `standard_products` pipeline
- worklist การจับคู่รายการยาบน `/mappings/v2` กลับมาแล้ว: เริ่มที่ `pending`, ค้นหารหัส/ชื่อยา, กรอง lifecycle (`pending`/`needs_review`/`mapped`/`all`) และชนิดยา (`01` TMT/`10` TTMT), ใช้ pagination ฝั่ง server 30 รายการต่อหน้า และแสดง identity TMT/TTMT ปัจจุบัน, UPDATEFLAG กับเหตุผล lifecycle
- การจับคู่/แก้ไขจาก worklist ใช้ source-aware `/api/v1/mappings/v2` เท่านั้น; needs_review ยืนยันด้วย acknowledgement เดิมแบบ idempotent และไม่กลับไปใช้ `standard_products` หรือ legacy save route
- ปุ่ม reconcile จาก Drug Catalog ปรากฏเฉพาะเมื่อ current source-aware catalog path ถูกเปิดใช้ (`TMT_V2_CATALOG_ENABLED`); service เดิมรองรับ identity TMT/TTMT อยู่แล้ว จึงไม่สร้าง reconcile path ใหม่

## TMT result presentation contract

เรียงข้อมูลผลค้นหาตามนี้เสมอ:

1. ระดับ TMT พร้อมสีและข้อความ
2. TMT ID
3. FSN
4. ชื่อการค้า
5. ผู้ผลิต
6. เลขทะเบียนยา
7. สถานะ
8. ความพร้อมจับคู่
9. actions

สีประจำระดับ: GP แดง, GPU เขียว, TP เหลือง, TPU น้ำเงิน และระดับอื่นใช้สีกลาง ต้องไม่ใช้สีอย่างเดียวโดยไม่มีข้อความระดับกำกับ

- Trade Name, Manufacturer หรือ RegNo ที่ไม่มีข้อมูลต้องแสดงเป็นค่าว่าง ไม่ใช้ `-`, `N/A` หรือค่าที่เดา
- RegNo ที่ latest state มีหลายค่าขัดแย้งต้องแสดง conflict และห้ามเลือกค่าหนึ่งโดยพลการ

## Standards search and application-version UX

`/standards` ใช้ advanced TMT search โดยมี independent filters ต่อไปนี้และใช้ AND semantics เมื่อกรอกหลายช่อง:

1. TMT ID
2. ชื่อยา / FSN
3. ชื่อสามัญ
4. ชื่อการค้า
5. ผู้ผลิต
6. เลขทะเบียนยา
7. ระดับ TMT
8. สถานะ
9. ความพร้อมจับคู่

backend ใช้ authoritative TMT v2 data เท่านั้น: รองรับ `tmtId`, `fsn`, generic name, trade name, manufacturer, registration, level, status และ mapping eligibility; รักษา `q`, ATC และ NLEM compatibility, query แบบไม่เกิด N+1 และห้าม fallback ไป `standard_products`.

- application version แสดงเฉพาะ shared global footer จาก authoritative `package.json` source
- TMT/TTMT dataset version ต้องมี label `เวอร์ชันข้อมูล TMT` หรือ `เวอร์ชันข้อมูล TTMT` เสมอ ไม่ใช้ `Version` แบบกำกวม
- TMT search status เริ่มต้นและการล้างตัวกรองกลับไป `ใช้งานอยู่`; ผู้ใช้ยังเลือก `ทั้งหมด` ได้เอง
- `active` แสดงทุก non-TPU ที่ตรงการค้นหา และแสดงเฉพาะ TPU ที่ MasterTMT `status=0`; ไม่ได้หมายถึง TPU-only
- `mappingEligible=true` จึงยังหมายถึงเฉพาะ active commercial TPU เท่านั้น แยกจาก status filter
- Hotfix นี้แก้ regression ที่ `active` เคยถูกใช้เป็น eligibility condition จน GP/GPU/TP หายจากผลค้นหา
- user-facing workflow ไม่ใช้คำว่า “v2” โดยไม่จำเป็น แต่ internal identifiers/routes เช่น `/mappings/v2`, feature flags และ schema names คงไว้เพื่อ compatibility/stability
- permanent application-version policy อยู่ใน [AGENTS.md](../AGENTS.md#application-versioning)

## Official TMT Browser research reference

- Reference: [Official TMT Browser](https://tmt.this.or.th/TMTBrowser.dll/dbWdv6Bwv060mydXh95Fpq/$/)
- official browser ใช้ช่อง `KEYWORD` ช่องเดียว; search result แสดง level color, TMTID และ FSN
- hierarchy ที่พบ: SUBS / VTM / GP / GPU / GPP / TP / TPU / TPP
- Lidocaine regression reference:
  - SUBS `224729` — lidocaine hydrochloride
  - VTM `764148` — lidocaine hydrochloride
  - GP `1147579` — lidocaine hydrochloride 400 mg/20 mL solution for injection
  - GPU `764169` — lidocaine hydrochloride 400 mg/20 mL solution for injection, 20 mL vial
  - TP `764176` — LIDOCAINE HYDROCHLORIDE — องค์การเภสัชกรรม
  - TPU `764182` — LIDOCAINE HYDROCHLORIDE — องค์การเภสัชกรรม, 20 mL vial
- Manufacturer: องค์การเภสัชกรรม; Strength: 400 mg/20 mL; NLEM: ED; ATC: C01BB01, N01BB02
- หน้าผล/detail ที่ตรวจไม่แสดง RegNo จึงห้าม infer หรือเดาเลขทะเบียนยา

## Next implementation checkpoint

Phase 2D ขั้นถัดไปคือ production readiness review แบบ read-only และอนุมัติ runbook/backup/restore/storage/TiDB preflight แยก. ห้าม copy production data, publish release จริง หรือเปิด `ACTIVE_STANDARD_RELEASE_ENABLED` บน production โดยไม่มี approval และ maintenance plan แยก.

ก่อนทำงาน UI ถัดไป ต้องรักษา TMT v2 result cards/colors/RegNo behavior, ไม่เพิ่ม schema/migration และไม่แก้ production data โดยไม่มี approval แยก

ก่อนเริ่ม implementation ให้ยืนยันว่า `origin/main` ยังตรงกับ checkpoint ที่เอกสารนี้ระบุ หลัง Codex รายงานงานเสร็จต้องตรวจ GitHub commit/diff เทียบ `main` จริง ไม่เชื่อเฉพาะรายงาน

## Known improvement backlog

### P1 Security

- enforce `must_change_password` flow
- เพิ่ม tenant isolation integration tests
- review security headers/CSP

### P2 Operations

- เพิ่ม CI workflow
- automatic cleanup nonce/token/staging/preview records
- monitoring/alerts
- backup/restore drill และ retention policy
- reconcile production checklist กับหลักฐานล่าสุด

### P3 UX

- Drug Catalog import diff summary
- ประเมิน long-running architecture ของ standard sync เมื่อปริมาณงานในอนาคตจำเป็น

รายการนี้เป็น backlog/analysis เท่านั้น ไม่ใช่งานที่ implement แล้วหรือคำสั่งให้เริ่มทำโดยอัตโนมัติ

## Last verified checkpoint

- Previous repository checkpoint: `97416b913e30a2ee1f5a463aae2b3f70cc6dd1ed`
- Current application version: `0.7.0`
- Production cutover: complete
- TMT assurance: `validated_unverified` under policy `validated-unverified-v1`
- Latest repository migration: `0018_versioned_standard_dataset_foundation.sql` (production latest applied remains `0017`)
- Agent version: `1.3.0`
- Release preparation: Phase 2D local implementation/integration verified; ready for reviewed `0.7.0` commit and push

ก่อนเริ่มงานใหม่ให้ตรวจ `git fetch origin main`, `git rev-parse HEAD`, `git rev-parse origin/main` และ `git status`
อย่าเชื่อเอกสารนี้หรือ chat memory แบบ blind เพราะสถานะอาจเปลี่ยนหลัง checkpoint นี้
