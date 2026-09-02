# Repository Working Agreement

## Scope

สร้างระบบใหม่ด้วย Next.js ตามเอกสารใน `docs/` อย่าคัดลอก PHP เดิมทั้งก้อน และอย่าย้ายฐานข้อมูลหรือข้อมูลผู้ใช้เดิมเว้นแต่มี migration ที่ผู้ใช้อนุมัติแยกต่างหาก

## Mandatory rules

- อ่าน `README.md`, `docs/BUSINESS_RULES.md`, `docs/ARCHITECTURE.md` และเอกสารของส่วนที่จะเปลี่ยนก่อนแก้โค้ด
- ใช้ TypeScript strict; หลีกเลี่ยง `any` และตรวจ input ภายนอกด้วย schema
- server action/route handler ทุกตัวต้องตรวจ authentication, role และ facility scope
- ห้าม log password, TMT credential, session token, Agent secret หรือ JHCIS credential
- ห้ามเก็บไฟล์จริงหรือความลับใน Git; ใช้ `.env.example` เฉพาะ placeholder
- การเปลี่ยน schema ต้องทำผ่าน migration และมี rollback/forward-fix note
- การส่งออกต้องใช้แม่แบบ `.xls` ที่ผ่านการอนุมัติและต้องยืนยันหัวตาราง 22 ช่องก่อนเขียน
- ห้ามเปลี่ยนกฎ PRODUCTCAT, UPDATEFLAG หรือ ISED โดยไม่มีหลักฐานอ้างอิงและ test fixture
- UI ต้อง compact, responsive และ mutation ปกติห้ามทำ full-page reload หรือเลื่อนกลับด้านบน
- ทำ test เฉพาะส่วนที่เปลี่ยน พร้อม regression test สำหรับกฎสำคัญที่เกี่ยวข้อง

## Definition of done

- acceptance criteria ของ phase/issue ผ่าน
- tenant isolation test ผ่านทั้ง user และ admin
- ไม่มี secret/data จริงใน diff
- typecheck, lint และ test ที่เกี่ยวข้องผ่าน
- migration และ env/documentation อัปเดตตามการเปลี่ยนแปลง
- ถ้าแตะ Excel ต้องตรวจหัวตาราง ลำดับ ชนิดไฟล์ และเปิดผลลัพธ์ด้วยโปรแกรมอ่าน Excel จริง

