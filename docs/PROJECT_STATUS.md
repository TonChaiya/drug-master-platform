# Project status

เอกสารนี้เป็น handoff/current-state กลาง ไม่ใช่ business specification หรือ runbook
ข้อกำหนดถาวรอยู่ใน [SPEC.md](SPEC.md) และการปฏิบัติระบบอยู่ใน [OPERATIONS.md](OPERATIONS.md)

## Current production baseline

- Repository: [TonChaiya/drug-master-platform](https://github.com/TonChaiya/drug-master-platform)
- Branch: `main`
- Previous advanced TMT search checkpoint: `d60e91630652b4ea643663a7659fbdd929c85913`
- Current application version: `0.3.1`
- Hosting: Vercel production deployed through Git integration
- Production database: TiDB Cloud
- Latest applied migration: `0017_tmt_run_validations.sql`
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

- Previous repository checkpoint: `d60e91630652b4ea643663a7659fbdd929c85913`
- Current application version: `0.3.1`
- Production cutover: complete
- TMT assurance: `validated_unverified` under policy `validated-unverified-v1`
- Latest migration: `0017_tmt_run_validations.sql`
- Agent version: `1.3.0`
- Expected worktree: clean

ก่อนเริ่มงานใหม่ให้ตรวจ `git fetch origin main`, `git rev-parse HEAD`, `git rev-parse origin/main` และ `git status`
อย่าเชื่อเอกสารนี้หรือ chat memory แบบ blind เพราะสถานะอาจเปลี่ยนหลัง checkpoint นี้
