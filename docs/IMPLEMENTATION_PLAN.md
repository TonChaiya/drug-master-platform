# Implementation Plan

เป้าหมายคือ clean rewrite ไม่มีข้อมูลเดิมติดไป แต่รักษากฎที่ยืนยันแล้ว แบ่งงานเป็น phase พร้อม gate; ห้ามเรียก “พร้อมใช้งาน” ก่อน Phase 8

## Phase 0 — Repository and decisions

- สร้าง GitHub private repo และ scaffold Next.js App Router/TypeScript/Tailwind ด้วยเวอร์ชันปัจจุบัน
- ตั้ง pnpm, strict TS, ESLint/formatter, Vitest, Playwright และ CI
- ทำ PoC สามเรื่องก่อนล็อกสแตก: TiDB TLS/migrations, `.xls` BIFF8 locked template, Windows Agent HTTPS/HMAC
- อนุมัติ blank Excel template และเก็บไว้ใน `references/templates/`

Gate: CI เปล่าผ่าน, ไม่มี secret, decision log ของ 3 PoC พร้อม

## Phase 1 — Database and identity

- Drizzle schema/migrations ตาม `DATA_MODEL.md`
- facility, user signup pending, admin activation, login/session/logout/password change
- one-time admin bootstrap โดยไม่มี default password
- tenant policy/repository guard และ audit log

Gate: cross-facility integration tests ปฏิเสธทุกกรณี, Thai round-trip ผ่าน

## Phase 2 — Compact application shell

- responsive navigation, dashboard, admin effective-facility selector
- readiness row 3 แหล่ง, async mutation/toast, preserve scroll/filter
- user management ครบ username/name/position/facility/role/status/password

Gate: viewport 360/768/1024/1440 และ keyboard flow ผ่าน

## Phase 3 — Standards

- TMT token client, version, partitioned MasterTMT sync
- enrich `/nlem` + `/regno` โดย key ที่ยืนยัน; normalization warning
- MasterTTMT file import/version/history แยกจาก TMT API
- 5-field search API/UI แบบ debounce/cancel stale request

Gate: fixtures ยืนยัน generic/trade/manufacturer/regno/ISED และ active status

## Phase 4 — DrugCat

- private upload, parser/validation/hash/history
- latest snapshot per facility และ comparison service
- PRODUCTCAT/UPDATEFLAG rule tests
- real-row preview ของ import และ error report

Gate: template fixture `.xls`/`.xlsx`, duplicate, Thai, wrong header และ tenant mismatch ผ่าน

## Phase 5 — Agent and JHCIS

- v1 API HMAC/nonce/staging/atomic commit/commands
- update Windows tray ให้ install/upgrade/reconnect/reload config ได้
- office.offid validation และ query 01/10 เท่านั้น
- publish signed/versioned installer ใน GitHub Releases

Gate: clean install, upgrade over old version, reconnect another facility, office mismatch reject, replay reject และ 30k-row staged sync ผ่าน

## Phase 6 — Mapping workflow

- auto reconcile จาก latest DrugCat
- manual search/map แบบไม่ reload
- no approval state; mapping พร้อม export ทันที
- admin facility summary rows/details/delete/clear พร้อม audit

Gate: A/E decision table, TMT/TTMT type mismatch และ concurrent edit tests ผ่าน

## Phase 7 — Export

- preview จริงสำหรับ all-mapped/manual-changes
- writer ใช้ locked `.xls` template และ private generated file
- signed download, filename/date/encoding contract

Gate: เปิดไฟล์ได้, 22 headers ตรง, preview=count/data ตรง, Thai/leading zero ผ่าน

## Phase 8 — Production readiness

- security review, rate/size limits, backup/restore drill, monitoring, retention
- staging UAT กับสถานบริการตัวอย่างโดยข้อมูลทดสอบ
- rotate secrets, production migrations, smoke test และ rollback plan

Gate: owner ลงนาม UAT + security/deployment checklist; หลังจากนั้นจึงเรียกพร้อม production

## Migration from legacy

- ไม่ย้าย data โดย default ตามคำขอ
- ใช้ระบบเดิมเป็น reference เฉพาะกฎ/fixture; ห้ามให้ PHP database เป็น source of truth ใหม่
- หากภายหลังต้องย้าย mapping ให้ทำ export-transform-validate/import แยก มี facility reconciliation และ dry run ห้ามต่อฐานเก่าแล้ว copy ตรง

