# Project status

เอกสารนี้เป็น handoff/current-state กลาง ไม่ใช่ business specification หรือ runbook
ข้อกำหนดถาวรอยู่ใน [SPEC.md](SPEC.md) และการปฏิบัติระบบอยู่ใน [OPERATIONS.md](OPERATIONS.md)

## Current production baseline

- Repository: [TonChaiya/drug-master-platform](https://github.com/TonChaiya/drug-master-platform)
- Branch: `main`
- Production source checkpoint: `5fd6da3e7a8577ca82941fb5452f7d542a470364`
- Hosting: Vercel production deployed through Git integration
- Production database: TiDB Cloud
- Latest applied migration: `0013_shared_rate_limits.sql`
- Windows Agent baseline: `1.3.0`

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

## Verified production state

- production migrations `0010`–`0013` applied แล้ว
- login/signup/Agent enrollment rate limiter ผ่าน controlled production verification และไม่พบ fail-open/error
- expired rate-limit bucket cleanup เปิดใช้บน production ผ่าน Vercel Cron เวลา `30 19 * * *` UTC และ controlled invocation ผ่านโดยไม่แตะ business tables
- Agent 1.3.0 fresh enrollment production ผ่านสำหรับ facility `05957`
- หลัง Agent cleanup มีหนึ่ง installation และหนึ่ง active credential สำหรับเครื่องที่ตรวจ
- actual `office.offid` validation, MAC/IP/version telemetry และ heartbeat/JHCIS connected ผ่านการตรวจ
- Mapping lifecycle/review production smoke ผ่าน
- Export delta checkpoint flow ผ่าน controlled production verification
- หน้า Agent `/jhcis` และ status model ผ่าน production smoke

ข้อมูลข้างต้นไม่ใช่คำรับรองว่า security/operations checklist ทุกข้อผ่าน ดูรายการค้างด้านล่างและ [OPERATIONS.md](OPERATIONS.md#5-production-verification-checklist)

## Active redesign status

- TMT/TTMT Data Model v2 Phase 1 discovery/design เสร็จแล้วใน `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`
- Phase 1 ตรวจคู่มือและ live TMT API แบบ read-only รวมถึงพิสูจน์รหัส `764169`; ไม่มี production data change, migration หรือ deployment
- Phase 2 persistence/parser foundation สร้างแล้ว: Drizzle schema, additive migrations `0014_tmt_data_model_v2.sql`/`0015_ttmt_data_model_v2.sql`, typed parsers/client ครบ 18 endpoints และ targeted contracts
- Phase 2 recovery gates ผ่าน: production fixture cleanup ยืนยันแบบ read-only ว่าไม่เหลือข้อมูล, DB integration tests ใช้ fail-closed local-only guard และ full suite ไม่โหลด `.env.local`
- migrations 0014/0015 ผ่าน controlled Laragon MySQL จากฐานว่างถึง migration 0015 แต่ **ยังไม่ apply production**
- Phase 3 TMT v2 sync engine สร้างแล้ว: full/incremental/resume, version-bound run, endpoint checkpoint, bounded retry, optional isolation, idempotent persistence และ bounded invariant report
- Phase 4 TMT Browser/Search v2 สร้างแล้ว: authenticated exact/prefix/FSN search, filters, concept detail, MasterTMT/enrichment, bounded relationship graph และ mapping eligibility preview ที่ `/admin/tmt-v2`
- Phase 4 เป็น hidden/default-off (`TMT_V2_BROWSER_ENABLED` ต้องเท่ากับ `1` เท่านั้น) และเมื่อปิดจะไม่ query ตาราง v2; ไม่ได้เพิ่ม migration และไม่แตะ legacy navigation/search/mapping/export/catalog
- Phase 5 Mapping v2 เพิ่ม additive migration `0016_mapping_v2_identity.sql`, identity `(standard_source, standard_code, standard_level)`, resolver TMT/TTMT แยกกัน และ hidden `/mappings/v2`; default-off ต้องตั้งทั้ง `TMT_V2_MAPPING_ENABLED=1` และ Browser flag ใน local เท่านั้น
- Phase 5 ยังคง legacy `/mappings`, catalog reconcile, dashboard และ export ไว้ตาม `standard_products`; ไม่มี production migration/cutover/backfill และ legacy row ใช้ source/level `NULL` ได้
- Phase 5 ผ่าน local E2E บนฐานแยก: GPU `764169` บันทึกตรงไม่ได้, active TPU/TTMT บันทึกและ GET คืน server truth, inactive standard ปฏิเสธ, facility scope fail-closed และ review confirm/repeat no-op/identity staleness ผ่าน; visual 1366/768/390 ไม่มี horizontal overflow
- Phase 6 เพิ่ม consumer ฝั่ง Catalog/lifecycle/export สำหรับ identity v2 แบบ source-aware: TMT resolve เฉพาะ active TPU จาก MasterTMT พร้อม latest NLEM/RegNo และ TTMT resolve จาก `ttmt_products` โดยไม่ข้าม namespace
- Phase 6 full/delta export ยังคงสัญญา DrugCat 22 ช่อง, checkpoint จาก `drug_mappings.updatedAt`, preview one-time/stale protection และ review acknowledgement เดิม; GPU `764169` ไม่ถูก export และ fixture ที่เลือก TPU `565818` ส่งออก `TMTID=565818`
- Phase 6 ผ่าน local E2E บนฐาน exact `drug_master_export_v2_test` ถึง migration 0016 รวม full/delta/rollback/invalidation/tenant isolation และเปิดไฟล์ `.xls` จริงด้วย Microsoft Excel แล้ว; RegNo latest-date conflict ไม่เลือกค่าเองและ ATC ไม่ block export เพราะไม่อยู่ใน contract 22 ช่อง
- Catalog/export v2 ยัง default-off (`TMT_V2_CATALOG_ENABLED=1` และ `TMT_V2_EXPORT_ENABLED=1` ต้องเปิดแยกกัน) จึงไม่มี production cutover, migration หรือ environment change; production ยังใช้ legacy `standard_products`
- controlled live backfill ลง local MySQL ผ่านด้วย TMT version `20261102`: core ready, incremental replay 1,625 rowsเขียนใหม่ 0, และ `764169` ยืนยัน 1 GP / 9 TPU / 3 GPP โดย TPU ทั้ง 9 status 0
- `/imagelist` ล้มเหลวแบบ isolated 3 historical windows; invariant report พบ dangling relationship concepts 106, self relationships 16, ATC same-date conflicts 1,446 และ RegNo same-date conflicts 803 โดยไม่มี missing level/concept counterpart หรือ unknown status/level
- production application ยังใช้ `standard_products`, `standard_imports`, `standard_sync_runs` และ TTMT importer เดิม; migrations 0014/0015/0016 ยังไม่ production-applied
- ขั้นถัดไปหลัง Phase 6 คือ Phase 7 production reset/cutover ซึ่งต้องได้รับอนุมัติแยกและห้ามเริ่มโดยอัตโนมัติ

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

- Production source checkpoint: `5fd6da3e7a8577ca82941fb5452f7d542a470364`
- Latest migration: `0013_shared_rate_limits.sql`
- Agent version: `1.3.0`
- Expected worktree: clean

ก่อนเริ่มงานใหม่ให้ตรวจ `git rev-parse HEAD`, `git status` และ deployment/migration ที่เกี่ยวข้องจริง
อย่าเชื่อเอกสารนี้หรือ chat memory แบบ blind เพราะสถานะอาจเปลี่ยนหลัง checkpoint นี้
