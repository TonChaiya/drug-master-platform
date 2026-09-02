# Contributing

## Workflow

1. เลือกงานจาก phase ใน `docs/IMPLEMENTATION_PLAN.md` และระบุ acceptance criteria ใน issue
2. สร้าง branch ขนาดเล็ก เช่น `feat/agent-enrollment` หรือ `fix/export-ised`
3. เขียน migration/test ก่อนหรือพร้อม implementation สำหรับกฎข้อมูล
4. เปิด pull request พร้อมรายการ test ที่รันและผลกระทบต่อ schema/security
5. ห้าม merge เมื่อ tenant isolation, Agent authentication หรือ Excel contract test ไม่ผ่าน

## Commit hygiene

- แยก schema, application logic, UI และ generated artifact ให้ตรวจสอบง่าย
- ไม่ commit `.env`, dump ฐานข้อมูล, Excel ที่มีข้อมูลจริง, token หรือ installer
- ไฟล์ต้นแบบที่จำเป็นต้อง version ต้องผ่านการตรวจว่าไม่มีข้อมูลจริง/สิทธิ์ใช้งานก่อนเก็บใน `references/templates/`

## Review checklist

- ข้อมูลของ facility อื่นเข้าถึงไม่ได้แม้แก้ request เอง
- admin action ที่ลบ/ล้างมี audit log และ confirmation
- response/error ไม่เปิดเผย credential หรือ stack trace
- input ค้นหา/นำเข้า/ส่งออกมี limit และ validation
- UI ใช้งานได้ที่ 360, 768, 1024 และ 1440 px โดยไม่มีหัวข้อหรือการ์ดบังงานหลัก

