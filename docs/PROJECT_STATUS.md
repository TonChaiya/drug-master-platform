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
