# Project status

เอกสารนี้เป็น handoff/current-state กลาง ไม่ใช่ business specification หรือ runbook
ข้อกำหนดถาวรอยู่ใน [SPEC.md](SPEC.md) และการปฏิบัติระบบอยู่ใน [OPERATIONS.md](OPERATIONS.md)

## Current production baseline

- Repository: [TonChaiya/drug-master-platform](https://github.com/TonChaiya/drug-master-platform)
- Branch: `main`
- Production application version: `0.8.20`
- Compatible application deployed before the cutover: `47390b156e29d53871d9bc1ebd326d2df68190ee`
- Hosting: Vercel Production ผ่าน Git integration
- Health: `/api/v1/health` ตอบ HTTP `200`, database healthy และ TLS enabled ที่ checkpoint นี้
- Production database: TiDB Cloud
- Latest applied migration: `0020_tmt_independent_validation.sql`
- Windows Agent baseline: `1.3.0`

## Unified system improvement handoff

- Canonical controlled-improvement plan: [UNIFIED_SYSTEM_IMPROVEMENT_PLAN.md](UNIFIED_SYSTEM_IMPROVEMENT_PLAN.md)
- Status: Phase 2 Production cutover เสร็จแล้ววันที่ 2026-11-28. Production ใช้ live TMT/TTMT tables โดย Dataset Release ยังปิดอยู่ และยังไม่ได้ copy/publish Dataset Release.
- Release `0.8.14` เพิ่ม migration 0019 และ source-fidelity preservation สำหรับ `TTMTType`, `Changedate`, `Drug_Group_Nhso` ใน live/versioned TTMT rows. Import ยังคง upsert เฉพาะรหัสที่มีใน workbook, cell ว่างล้างค่าเดิมเป็น `NULL`, ไม่ลบ/deactivate รหัสที่หาย และยังใช้ `Status` เป็น eligibility input โดยไม่ตีความ `TTMTType=CANCEL`.
- Release `0.8.15` เตรียม guarded Migration 0019 executor สำหรับลำดับ `0018 → 0019` และ CLI one-time TTMT baseline replacement แบบ dry-run/fail-closed ซึ่งรักษา import/audit/mapping/history เดิมและไม่ลด duplicate version/hash protection. ยังไม่มี Production migration, reset หรือ baseline import ใน checkpoint นี้.
- Release `0.8.16` ประสาน canonical TTMT validation/replacement evidence ไปยัง MasterTTMT `20261001` hash `88618ebf566ed5680f7ad49c00e55ad920e6699c1324b707ea5375a440dca057` หลัง re-audit โครงสร้างและสถิติสำคัญผ่านครบ. Artifact นี้ได้รับอนุมัติใหม่หลัง binary identity เปลี่ยน โดยไม่ได้อ้างว่า binary-equivalent กับ workbook เดิม; migration, baseline replacement และ Dataset Release ยังไม่ได้ execute.
- Release `0.8.17` รวม guard เป้าหมายเป็น `LOCAL_CLONE_REHEARSAL`, `TEST`, `PRODUCTION` โดย local clone ต้องใช้ `--rehearsal` และยังปฏิเสธ port 3333/`jhcisdb`/remote target. Local Production clone บน Laragon ผ่าน 0017→0018→0019 และ controlled TTMT replacement ครบ: 9,654 unique codes, `RECIPE/SINGLE/CANCEL` 6,790/2,847/17, mappings/history เดิมคงอยู่ และ maintenance ถูกปิดหลัง rehearsal. Production database ยังไม่ถูก migrate หรือ rebuild.
- Release `0.8.18` เพิ่ม Production readiness contract แบบ external non-secret evidence, บังคับ explicit intent/operation/TiDB Cloud/mysql2/TLS ใน shared target guard และเพิ่ม ownership-guarded TiDB probe สำหรับ FK/collation/nullable ALTER/transaction rollback/row lock/partial DDL. TiDB Cloud export `exp-5cdjkve5g5cklkxyb4ucfciplm` ผ่าน restore rehearsal บน isolated MySQL 8.4.3 แล้ว; probe จริง, Migration 0018/0019 และ TTMT replacement บน Production ยัง **ไม่ execute**.
- Release `0.8.19` ให้ readiness guard รับคำยืนยันเรื่องพื้นที่ที่ระบุเวลาและ operation จาก operator โดยตัวเลขพื้นที่เป็น optional. Production probe, Migration 0018/0019 และ TTMT replacement ยังไม่ดำเนินการใน release นี้.
- Approved TTMT cutover workbook `20261001` ฉบับที่ operator ดาวน์โหลดใหม่จากหน้าเว็บมาตรฐานใช้ SHA-256 `071cb3d3708865f8d1428e23f25216ba65e6acb21e436070587d98a59dbce5c3`. Parser ตรวจ worksheet `l_ttmt_master_ed` และ 15 columns ผ่าน. หลัง replacement ตรวจได้ 9,654 unique codes, Status Active 9,654, RECIPE/SINGLE/CANCEL 6,790/2,847/17 และ ED/NED 5,539/4,115. สถิติหลักตรงกับหลักฐานเดิมและ binary hash ต่างกัน.
- The plan preserves the current acceptance constraints: one user-facing system, compact responsive UI, application version only in the shared footer, and no production/schema/migration/deploy changes without separate approval.
- Phase 2 Production: TiDB probe และ cleanup ผ่าน, journal และ schema `0018 → 0019 → 0020` ผ่าน, guarded TTMT replacement ผ่าน, และปิด maintenance หลังตรวจข้อมูล. TMT ยังคง `validated_unverified` ด้วย evidence เดิมโดยไม่ต้อง sync หรือ revalidate. TMT readiness ตรวจหลักฐาน TMT ส่วน TTMT ตรวจ Status และ provenance จาก import ที่สำเร็จของแต่ละแถว. Dataset Release ตรวจและผูกหลักฐานทั้งสองแหล่งก่อน publish ตามขั้นตอนอนุมัติของตัวเอง.
- Recovery evidence: logical backup วันที่ 2026-11-28 ใช้ consistent snapshot TSO `470767359029149910`, ตรวจครบ 44 tables และ SHA-256 `999676e2928c2cdb326d89d3ff0ee10a547c501db5570b6edd11dd491347b5cf`. TiDB Cloud export `exp-5cdjkve5g5cklkxyb4ucfciplm` เป็นหลักฐาน restore rehearsal.

## Phase 4 consolidation checkpoint

- Release `0.8.3` ทำให้ `/mappings` เป็น user-facing route หลักเพียงเส้นทางเดียว; `/mappings/v2` คงไว้เป็น compatibility redirect และ API/schema identifiers ภายในไม่เปลี่ยน.
- Dashboard, navigation และ Drug Catalog ใช้ `/mappings` ทั้งหมด โดย feature flags เดิมยังเลือก current/compatibility implementation ภายในและค่า default ไม่เปลี่ยน.
- Standards Hub resolve approved Active Release แบบ fail-closed เมื่อ `ACTIVE_STANDARD_RELEASE_ENABLED=1` และนับ TMT/TTMT จาก `tmt_dataset_mastertmt`/`ttmt_dataset_products` ด้วย dataset IDs ของ release เดียวกัน; เมื่อ flag ปิดยังใช้ live-table behavior เดิม.
- ตัดคำเรียกระบบแบบ `legacy` ออกจากข้อความผู้ใช้ใน Standards Hub โดยยังเก็บ internal compatibility APIs/data และไม่ลบ route, table หรือ history ใด ๆ.
- Phase 3 การเริ่ม TMT sync จาก Admin ยังไม่ implement: runtime ปัจจุบันมี CLI-only runner และไม่มี durable background execution ที่ผ่านการอนุมัติ จึงคง read-only monitoring เดิมไว้เพื่อไม่ผูกงานยาวกับ HTTP request.

## Phase 3–5 usability checkpoint

- Release `0.8.13` ลด surface ซ้อนใน Mapping chooser: workspace ใช้เพียงขอบบน/ล่าง, filters คง unboxed และ results ใช้ tinted section กับ shared list/dividers โดยเก็บ bordered cards เฉพาะข้อมูลเปรียบเทียบสองฝั่ง; behavior เดิมไม่เปลี่ยน.
- Release `0.8.12` ปรับ Mapping chooser ให้ใกล้ visual target: workspace กว้างขึ้นและผูกกับ selected row, context cards กระชับ, filters เรียงเป็นแถวเดียว และ results เป็น cool-tinted panel ที่มี candidate rows ต่อเนื่องแบบตาราง; interaction และ mapping semantics เดิมไม่เปลี่ยน.
- Release `0.8.11` จัด Mapping chooser เป็น context cards, filter group และ results panel ที่แยกชั้นชัดเจน; แสดง action “ดู TPU ที่เกี่ยวข้อง” เฉพาะ GPU พร้อม loading/empty/error state และไม่แสดงปุ่มรายละเอียดที่ไม่มีพฤติกรรมบน TPU โดยไม่เปลี่ยน search หรือ mapping semantics.
- Release `0.8.10` ปรับ candidate TMT/TTMT เป็นสัดส่วน desktop 48/28/24, รวม metadata เป็น vertical block และจัด status/current marker กับ actions เป็นกลุ่มด้านขวา โดยยัง stack/wrap ได้และไม่เปลี่ยน semantics.
- Release `0.8.9` จัด Mapping chooser ให้อยู่ใน workspace กึ่งกลางกว้างสูงสุด 72rem, ปรับสัดส่วนตัวกรอง และจัด candidate TMT/TTMT เป็น 3-zone rows บน desktop ที่ stack/wrap ได้บนจอเล็ก โดยไม่เปลี่ยน search หรือ mapping behavior.
- Release `0.8.8` ลดความสูงและช่องว่างของ candidate TMT/TTMT ใน Mapping chooser, รวม metadata สำคัญเป็นแถว compact และแยกพื้นที่ผลค้นหาด้วย neutral surface โดยคง safety badges, current marker และ actions เดิม.
- Release `0.8.7` เพิ่มบริบทเปรียบเทียบ JHCIS กับมาตรฐานปัจจุบันใน Mapping chooser, ทำเครื่องหมาย candidate ที่เลือกอยู่, แสดงเหตุผลเมื่อ Catalog reconcile ไม่พร้อม และเพิ่ม loading/empty/error states แบบ compact; save/reconcile, lifecycle, acknowledgement และ API contracts เดิมไม่เปลี่ยน.
- Release `0.8.6` คืนตัวกรองค้นหามาตรฐาน 5 ช่องใน Mapping chooser พร้อม debounce, stale-response protection และ clear แบบไม่ reload; TMT ใช้ authoritative search/readiness เดิม ส่วน TTMT ใช้ AND filters ที่คง succeeded-import และ active-dataset isolation.
- Release `0.8.5` คืนข้อมูลช่วยตัดสินใจใน Mapping worklist: ชื่อสามัญ/ตัวยาสำคัญ, ความแรง, รูปแบบยา, ผู้ผลิต และที่มาของ mapping โดยใช้ batch resolver และ identity TMT/TTMT เดิม; ไม่เพิ่ม query, ไม่เปลี่ยน lifecycle/save/reconcile และไม่แตะ schema.
- Release `0.8.4` เพิ่ม live monitoring เฉพาะขณะ TMT run มีสถานะ `running`: Admin refresh สถานะ/checkpoint ทุก 15 วินาทีโดยไม่เริ่มงานซ้ำ และแยกข้อความเริ่มงาน, progress, failure และ guarded resume ชัดเจน. การเริ่ม/resume ยังคงเป็น CLI-only จนกว่าจะมี durable execution ที่อนุมัติ.
- หน้า Export แสดงตัวเลือก `Full` และ `Delta` ชัดเจนขึ้น โดยใช้ preview token และ checkpoint semantics เดิมทั้งหมด.
- หน้า Mapping เปลี่ยนข้อความ readiness ให้เป็นภาษาผู้ใช้; fail-closed behavior, feature flags, lifecycle, audit และ export checkpoint ไม่เปลี่ยน.

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
- Isolated Laragon MySQL verification วันที่ 2026-11-14 ผ่าน 9/9 ด้วย synthetic fixtures และ dedicated account: fresh/0017→0018 journal transition, schema keys/FKs, dataset isolation, bounded resume/source mutation, deterministic manifests, evidence/RegNo gates, explicit approval, concurrent publish, shared pointer lock, atomic publish, pointer-only rollback, immutability และ audit evidence. Cleanup ยืนยันฐานเป้าหมายหาย, lock ว่าง, ไม่มี test-user connection และ database inventory เดิมไม่เปลี่ยน.
- Full non-DB verification ปิด DB opt-in ผ่าน 308 tests / 60 guarded skips; typecheck, lint และ diff-check ผ่าน. ไม่มี production access, production migration, baseline copy, publish/rollback หรือ feature-flag activation.
- Guarded CLI `dataset:release` รองรับ `preflight/status/baseline/resume/validate/approve/publish/rollback/verify`, โหลดเฉพาะ env file ที่ระบุ และ mutation ต้องมี exact database/action confirmation, actor และ reason. CLI ยังไม่เคย execute กับ Production.
- Migration 0018 ที่ apply บน Production ใช้ hash `321d760bc2a89efd69248bdce6a57a5562e108edd31a50524c2870a3ee94ec41`: ต่อจาก explicit shadow schema hash `95d21cae…` โดยกำหนด collation ของสาม external FK ให้ตรง source tables (`utf8mb4_unicode_ci`) เพื่อให้ MySQL 8.4 สร้าง FK ได้โดยไม่เปลี่ยน logical contract. Environment ที่มี journal hash เก่าต้องหยุดและใช้ reconciliation แยก ห้ามแก้ journal.
- Guarded Migration 0018 executor เป็น dry-run โดย default, รับเฉพาะ env file นอก repository, ตรวจ exact database/TLS/hash/journal 0001–0017/maintenance/partial schema และเขียน journal เดิมหลัง DDL กับ post-schema verification สำเร็จครบเท่านั้น. TiDB DDL ไม่ transactional; partial DDL ต้องหยุด manual reconciliation และห้าม retry อัตโนมัติ.
- TiDB 8.5.3 ownership-guarded probe ผ่านบน Production instance เดิมและตรวจ cleanup ผ่านแล้ว. Production ผ่าน guarded migration 0018/0019/0020 และ TTMT replacement. Dataset Release copy/publish ยังเป็นงานแยกเมื่อได้รับอนุมัติ.

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

- Production migration journal ตรวจตรงตามไฟล์ตั้งแต่ `0001` ถึง `0020`
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
- TTMT production baseline มาจาก audited replacement ของ workbook ที่อนุมัติข้างต้น. Import เดิม `46ac7956-4a52-43da-8f0a-c54fa392a70c` ถูกเก็บเป็นประวัติ.
- เวอร์ชันข้อมูล TTMT: `20261001`
- legacy `standard_*`/`standard_products` API และข้อมูลยังคงอยู่เพื่อ compatibility แต่ไม่ใช่แหล่งมาตรฐานหลักของ production workflow

## Current UX workflow

- UX-1 checkpoint: `e13e5530d40db3603955743ec3999207ac5e1aae`
- UX-2 checkpoint: `e60cda79c997622834d6562e1a1c72ff2efabe40`
- workflow ปัจจุบัน: JHCIS → Standards Hub → Drug Catalog → การจับคู่รายการยา → Export
- navigation หลักชี้ไปการจับคู่รายการยา; `/mappings` เป็น route หลักและ `/mappings/v2` เป็น compatibility redirect
- `/standards` ไม่แสดง legacy standards sync ใน normal workflow เพื่อไม่ให้ผู้ใช้เข้าใจว่าเป็นข้อมูล TMT ปัจจุบัน
- `/admin` แสดง current TMT v2 readiness, latest run, bounded run/checkpoint history และ current TTMT v2 import history เฉพาะผู้ดูแลระบบ
- การเริ่มหรือ resume TMT sync ยังเป็น CLI-only เพราะต้องยืนยัน environment/database, mode และ production guard สำหรับงานที่อาจใช้เวลานาน; Admin ไม่เริ่มงานนี้จาก web request
- Admin สามารถนำเข้าไฟล์ MasterTTMT `.xls`/`.xlsx` ด้วย current TTMT v2 importer เท่านั้น; route ใช้ `requireAdmin()` และไม่เรียก legacy `standard_products` pipeline
- worklist การจับคู่รายการยาบน `/mappings` กลับมาแล้ว: เริ่มที่ `pending`, ค้นหารหัส/ชื่อยา, กรอง lifecycle (`pending`/`needs_review`/`mapped`/`all`) และชนิดยา (`01` TMT/`10` TTMT), ใช้ pagination ฝั่ง server 30 รายการต่อหน้า และแสดง identity TMT/TTMT ปัจจุบัน, UPDATEFLAG กับเหตุผล lifecycle
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

Phase 2D production rollout ยังต้องอนุมัติ runbook/backup/restore/storage และ Migration 0018 แยก. Phase 4 ให้ทำ feature-parity regression ต่อโดยคง `/mappings` เป็น route หลัก; ห้าม copy production data, publish release จริง หรือเปิด `ACTIVE_STANDARD_RELEASE_ENABLED` บน production โดยไม่มี approval และ maintenance plan แยก.

Mapping recovery/UX refinement เสร็จและตรวจ production แล้วที่ `0.8.13`. งาน audit ถัดไปให้ทำแยกขอบเขตตามลำดับ:

1. Standard Browser และมาตรฐาน TMT/TTMT
2. Drug Catalog
3. Export DrugCat
4. Dashboard/Admin
5. internal architecture/`v2` cleanup หลังพิสูจน์ compatibility

ชื่อ `v2` ใน API, schema, feature flags และ internal contracts ยังเป็น compatibility boundary
ห้าม rename/delete เพียงเพื่อปรับข้อความผู้ใช้หรือทำ cleanup โดยไม่มี dependency evidence และการอนุมัติแยก.

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

## Historical checkpoint (recorded before the 0.8.13 Mapping UX releases)

รายการด้านล่างเก็บไว้เป็นหลักฐานของ checkpoint เดิมและไม่ใช่ current production baseline;
สถานะปัจจุบันอยู่ที่หัวเอกสารนี้

- Previous repository checkpoint: `3ccc48107c4ea0e2698164ff21c37c284641128e`
- Application version at that checkpoint: `0.8.6`
- Production cutover: complete
- TMT assurance: `validated_unverified` under policy `validated-unverified-v1`
- Latest repository migration: `0019_ttmt_source_fidelity.sql` (production latest applied remains `0017`)
- Agent version: `1.3.0`
- Release preparation: Migration 0018 compatibility rewrite, guarded Migration 0018 executor และ guarded Dataset Release CLI ผ่าน local MySQL verification; Production rollout ยัง blocked ที่ disposable TiDB evidence, storage/headroom และ backup/restore rehearsal

ก่อนเริ่มงานใหม่ให้ตรวจ `git fetch origin main`, `git rev-parse HEAD`, `git rev-parse origin/main` และ `git status`
อย่าเชื่อเอกสารนี้หรือ chat memory แบบ blind เพราะสถานะอาจเปลี่ยนหลัง checkpoint นี้
