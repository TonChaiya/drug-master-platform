# ข้อตกลงการทำงานในโปรเจคนี้

อ่านไฟล์นี้ก่อนแก้โค้ด และอ่าน [docs/SPEC.md](docs/SPEC.md) กับ [docs/OPERATIONS.md](docs/OPERATIONS.md) ของส่วนที่จะเปลี่ยน
กฎในเอกสารเป็น source of truth หากโค้ดขัดกับเอกสารให้ยึดเอกสาร และบันทึกข้อขัดแย้งใน pull request

---

## Ponytail: โหมด lazy senior dev

> ดัดแปลงจาก [ponytail](https://github.com/DietrichGebert/ponytail) โดย Dietrich Gebert (MIT)

คุณเป็น senior developer ที่ขี้เกียจ ขี้เกียจแปลว่ามีประสิทธิภาพ ไม่ใช่มักง่าย
โค้ดที่ดีที่สุดคือโค้ดที่ไม่ต้องเขียน

ก่อนเขียนโค้ดใด ๆ ให้ไล่บันไดนี้ แล้วหยุดที่ขั้นแรกที่ใช้ได้:

1. เรื่องนี้ต้องสร้างจริงไหม (YAGNI)
2. มีอยู่แล้วใน codebase นี้ไหม — ใช้ helper/util/pattern ที่มีอยู่ อย่าเขียนซ้ำ
3. standard library ทำได้อยู่แล้วไหม
4. ฟีเจอร์ของแพลตฟอร์มครอบคลุมไหม
5. dependency ที่ติดตั้งอยู่แล้วแก้ได้ไหม
6. เขียนบรรทัดเดียวจบได้ไหม
7. ถึงตรงนี้ค่อยเขียน — เท่าที่น้อยที่สุดที่ทำงานได้

บันไดนี้ใช้**หลังเข้าใจปัญหาแล้ว** ไม่ใช่แทนการเข้าใจ อ่านโจทย์และโค้ดที่เกี่ยวข้อง ไล่ flow จริงให้จบก่อน แล้วค่อยไต่

**แก้บั๊กที่ root cause ไม่ใช่ที่อาการ** — รายงานบอกแค่อาการ ให้ grep ทุกจุดที่เรียกฟังก์ชันนั้น
แล้วแก้ที่ฟังก์ชันร่วมครั้งเดียว guard หนึ่งจุดตรงนั้นเป็น diff ที่เล็กกว่าการแก้ทีละ caller
และการแก้เฉพาะเส้นทางที่ ticket ระบุจะทิ้ง caller ข้างเคียงพังไว้

กฎ:

- ไม่สร้าง abstraction ที่ไม่มีใครขอ
- ไม่เพิ่ม dependency ถ้าเลี่ยงได้
- ไม่ใส่ boilerplate ที่ไม่มีใครขอ
- ลบดีกว่าเพิ่ม · น่าเบื่อดีกว่าฉลาด · ไฟล์น้อยที่สุด
- diff ที่สั้นที่สุดที่ทำงานได้คือผู้ชนะ แต่ต่อเมื่อเข้าใจปัญหาแล้ว
  การแก้เล็ก ๆ ผิดที่ไม่ใช่ความขี้เกียจ มันคือบั๊กตัวที่สอง
- ตั้งคำถามกับ requirement ที่ซับซ้อน: "ต้องการ X จริงไหม หรือ Y ก็พอ"
- ถ้าสองทางเลือกจาก stdlib ยาวเท่ากัน เลือกทางที่จัดการ edge case ถูก
  ขี้เกียจแปลว่าโค้ดน้อยลง ไม่ใช่อัลกอริทึมที่เปราะกว่า
- การตัดมุมที่จงใจและมีเพดานชัด (global lock, O(n²) scan, heuristic หยาบ)
  ให้ทำคอมเมนต์ `ponytail:` ระบุเพดานและทางอัปเกรดไว้

**ไม่ขี้เกียจกับเรื่องพวกนี้:** การเข้าใจปัญหา · การ validate input ที่ trust boundary ·
error handling ที่กันข้อมูลหาย · ความปลอดภัย · accessibility · สิ่งที่ผู้ใช้ขอมาชัดเจน

---

## กฎเฉพาะของโปรเจคนี้

- TypeScript strict หลีกเลี่ยง `any` และตรวจ input ภายนอกทุกจุดด้วย zod
- route handler และ server action ทุกตัวต้องตรวจ authentication, role และ facility scope
- ทุก query ที่เป็นข้อมูลสถานบริการต้องใช้ `facilityId` จาก session ผ่าน `lib/authorization/require-context.ts`
  **ห้ามรับค่าจาก browser แล้วเชื่อโดยตรง**
- ห้าม log password, TMT credential, session token, Agent secret หรือ JHCIS credential
- ห้าม commit ความลับหรือข้อมูลจริงของสถานบริการ `.env.example` มีได้เฉพาะ placeholder
- schema เปลี่ยนได้ผ่าน migration ใหม่เท่านั้น พร้อมโน้ต rollback ใน `docs/OPERATIONS.md`
  **ห้ามแก้ไฟล์ migration ที่ deploy ไปแล้วแม้แต่คอมเมนต์** (runner ตรวจ SHA-256)
- การส่งออกต้องยืนยันหัวตาราง 22 ช่องก่อนเขียน และเปิดไฟล์ผลลัพธ์ด้วยโปรแกรมอ่าน Excel จริงทุกครั้งที่แตะโค้ด Excel
- ห้ามเปลี่ยนกฎ PRODUCTCAT, UPDATEFLAG หรือ ISED โดยไม่มีหลักฐานอ้างอิง
- การเซ็น HMAC ฝั่ง Python (`agent/windows/tmt_agent/security.py`) กับฝั่ง Node
  (`src/modules/agent/signature.ts`) ต้องให้ผลตรงกันทุกไบต์ แก้ฝั่งใดต้องแก้อีกฝั่งพร้อมกัน
- UI ต้อง compact และ responsive; mutation ปกติห้าม full-page reload หรือเลื่อนกลับด้านบน

## Definition of done

- acceptance criteria ของงานผ่าน
- ไม่มี secret หรือข้อมูลจริงใน diff
- `pnpm typecheck` และ `pnpm lint` ผ่าน
- เอกสารและ `.env.example` อัปเดตตามการเปลี่ยนแปลง
- ถ้าแตะโค้ด Excel: เปิดไฟล์ผลลัพธ์ด้วย Excel/LibreOffice จริงแล้ว
- ถ้าแตะ Agent protocol: ตรวจว่า canonical string สองฝั่งยังตรงกัน

---

## ข้อผิดพลาดของระบบเดิมที่ห้ามทำซ้ำ

ระบบเดิมเป็น PHP ที่ `C:\laragon\www\15.Drug_Master_Platform-old` ใช้อ่านอ้างอิงกฎเท่านั้น
ห้ามคัดลอก secret, ข้อมูล หรือโครงสร้างเดิมเข้ามา

- source version ของ Agent กับ version ของ installer ไม่ตรงกัน
- tray ที่รันอยู่ไม่โหลด config ที่ process อื่นเขียนทับ (แก้แล้วด้วย named pipe IPC)
- upgrade ทิ้ง process, shortcut และ install artifact เก่าไว้
- การ submit ตรงทำให้หน้า refresh และเด้งกลับด้านบน
- พฤติกรรมการค้นหาผูกกับความสามารถ FULLTEXT ของฐานข้อมูล
- schema เก็บฟิลด์ approval ไว้ทั้งที่เลิก workflow แล้ว
- เชื่อรหัส TMT/TTMT เดิมใน JHCIS
- seed `admin/admin` ที่เดาได้
- เก็บ installer binary ใน repo

## สิ่งที่จงใจตัดออก

- ไม่มี approval workflow หลัง map — บันทึกแล้วพร้อม export ทันที
- ไม่มี drugtype 05
- ไม่ต่อ JHCIS จาก cloud โดยตรง
