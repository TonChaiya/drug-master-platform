# Test Plan

ทดสอบเฉพาะส่วนที่เปลี่ยนในแต่ละ PR แต่ชุด critical regression ด้านล่างต้องรันทุก release

## Unit tests

- facility code: รับเลข 5 หลัก ปฏิเสธ `0000x`/ตัวอักษร/ความยาวผิด
- JHCIS row filter: รับ active 01/10 เท่านั้น
- standard type: 01=TMT, 10=TTMT; ปฏิเสธ cross-type/inactive
- NLEM normalization: ED→E, ED*→E*, NED→N, unknown→blank+warning
- UPDATEFLAG: missing latest row=A, existing row changed=E
- PRODUCTCAT: 01→1, 10→3, SPECPREP blank
- Agent canonical signature, timestamp, nonce และ constant-time verification
- exact 22 Excel headers/date/identifier serialization

## Integration tests

- signup pending -> login denied -> admin activate -> login succeeds
- user A อ่าน/แก้ facility B ไม่ได้ผ่าน URL/body/query ที่ดัดแปลง
- admin เลือก effective facility แล้ว action/audit ตรงแห่ง
- initial TMT sync partition retry/dedupe และ enrich join
- DrugCat import duplicate/wrong header/hash/type reconciliation
- staged Agent sync ไม่แตะ live rows ก่อน finish; retry batch idempotent
- officeId mismatch/revoked key/replayed nonce/oversized payload ถูกปฏิเสธ
- map บันทึกแล้ว export ได้ทันทีโดยไม่มี approval
- Connectivity PoC: signed Agent report ถูกบันทึกและอ่านกลับจาก TiDB ผ่าน TLS โดยเก็บเฉพาะ office/count; replay nonce ซ้ำต้องถูกปฏิเสธ

## End-to-end

1. สมัคร facility ใหม่และอนุมัติ
2. enroll Agent, ตรวจ office, สั่ง sync และเห็น readiness เขียว
3. sync/import standards + DrugCat และเห็น comparison จริง
4. ค้นด้วยแต่ละ field, ล้างค่าโดยไม่ reload, map รายการคงค้าง
5. preview all/manual และดาวน์โหลด `.xls`
6. admin ดูแถวสรุปทุก facility เข้า detail และล้างเฉพาะเป้าหมาย
7. เปลี่ยน enrollment เครื่องเดิมไป facility อื่นอย่างปลอดภัย

## Non-functional

- 30,000 source rows และ standard catalog ขนาดจริง: pagination/search latency/import memory
- responsive 360/768/1024/1440, Thai text, keyboard/focus, contrast
- security: CSRF/session fixation, authz matrix, rate limit, secret redaction, upload bomb/path traversal
- resilience: TMT timeout, Agent disconnect mid-batch, duplicate command, DB retry, expired signed URL
- Excel visual/open test ใน Excel หรือ LibreOffice และ automated header/content checksum

## Fixtures

เก็บเฉพาะ synthetic/anonymized fixtures ใน repo:

- facility 05957 ใช้เป็นรหัสตัวอย่างได้ แต่ชื่อ/ยา/ผู้ใช้ต้องเป็นข้อมูลทดสอบ
- TMT/NLEM/REGNO subsets ที่ครอบคลุม ED, ED*, NED, inactive, missing enrichment
- JHCIS rows 01/10/05/inactive เพื่อพิสูจน์ filter
- blank approved `.xls` template และ expected export เล็ก ๆ ที่ไม่มีข้อมูลจริง
