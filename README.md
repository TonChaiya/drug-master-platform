# TMT Drug Master Platform — Next.js Rewrite

พื้นที่นี้เป็นข้อกำหนดและแผนสร้างระบบใหม่จาก `15.Drug_Master_Platform-old` โดยเขียนใหม่ด้วย Next.js ไม่ใช่การแปลงโค้ด PHP แบบบรรทัดต่อบรรทัด และไม่ย้ายข้อมูลจริง รหัสผ่าน token หรือไฟล์ติดตั้งเก่าเข้ามา

## เป้าหมาย

- ดึงรายการยาที่เปิดใช้งานจาก JHCIS ของแต่ละสถานบริการผ่าน Windows Agent
- เทียบ Drug Catalog ล่าสุดและคง mapping ที่ถูกต้อง
- ค้นและ map มาตรฐาน TMT/TTMT โดยไม่เชื่อรหัสเดิมใน JHCIS
- ส่งออกไฟล์ DrugCat `.xls` จากแม่แบบเดิมโดยคง 22 คอลัมน์
- แยกข้อมูลทุกสถานบริการอย่างเคร่งครัด และให้ admin เห็นภาพรวมทั้งหมด

## สแตกที่เสนอ

- Next.js App Router + TypeScript
- Tailwind CSS สำหรับ UI แบบ compact และ responsive
- TiDB Cloud Starter (MySQL compatible) ผ่าน `DATABASE_URL`
- Drizzle ORM + migrations โดยไม่ใช้ trigger/stored procedure
- Zod สำหรับตรวจ input และ boundary ของ API
- Vitest สำหรับ unit/integration และ Playwright สำหรับ workflow สำคัญ
- Object storage แบบ private สำหรับไฟล์นำเข้า/ส่งออกที่เกินข้อจำกัด request ของโฮสต์
- GitHub Releases สำหรับไฟล์ติดตั้ง Windows Agent

เวอร์ชันแพ็กเกจยังไม่ถูกล็อกในขั้นเอกสาร ต้องตรวจเวอร์ชันปัจจุบันก่อนเริ่ม scaffold

## เอกสารหลัก

- [ขอบเขตและกฎธุรกิจ](docs/BUSINESS_RULES.md)
- [สถาปัตยกรรม](docs/ARCHITECTURE.md)
- [แบบจำลองข้อมูล](docs/DATA_MODEL.md)
- [โปรโตคอล Agent](docs/AGENT_PROTOCOL.md)
- [การใช้ TMT API](docs/TMT_API.md)
- [DrugCat และการส่งออก](docs/DRUGCAT_EXPORT.md)
- [ความปลอดภัยและการขึ้นระบบ](docs/SECURITY_AND_DEPLOYMENT.md)
- [แผนดำเนินงาน](docs/IMPLEMENTATION_PLAN.md)
- [แผนทดสอบ](docs/TEST_PLAN.md)
- [แผนผังอ้างอิงระบบเดิม](docs/LEGACY_TRACEABILITY.md)

## สถานะ

ขณะนี้มี Connectivity PoC สำหรับ Next.js และ Windows Agent แล้ว แต่ยังไม่ควร deploy เป็น production ตัว PoC ส่งเฉพาะผลเชื่อมต่อ JHCIS, `officeId` และจำนวนรายการที่เข้าเงื่อนไข ไม่ส่งแถวยาจริง

ค่าเริ่มต้นใช้ memory store สำหรับทดสอบในเครื่อง หากต้องการทดสอบ TiDB ให้คัดลอก placeholder จาก `.env.example` ไป `.env.local`, ตั้ง `POC_STATE_STORE=tidb`, ใช้ชื่อฐานเฉพาะที่ไม่ใช่ `sys` แล้วรัน `pnpm poc:migrate` ก่อนเริ่มเว็บ ความลับต้องอยู่ใน `.env.local` เท่านั้น

## หลักการสำคัญ

1. ทุก query ที่เป็นข้อมูลสถานบริการต้องมี `facilityId` จาก session/authorization context ห้ามรับจาก browser แล้วเชื่อโดยตรง
2. เว็บบนอินเทอร์เน็ตห้ามเชื่อม MySQL ใน LAN โดยตรง ต้องรับข้อมูลจาก Agent แบบ outbound HTTPS เท่านั้น
3. รหัสฐาน JHCIS อยู่ในเครื่องสถานบริการและป้องกันด้วย Windows DPAPI ห้ามส่งขึ้นฐานกลาง
4. TMT API credential อยู่ฝั่ง server เท่านั้น และค่าที่เคยเปิดเผยต้องเปลี่ยนก่อน production
5. ไม่มีขั้นตอนอนุมัติหลัง map; เมื่อบันทึกสำเร็จให้พร้อมส่งออกได้ทันที
6. ห้าม seed `admin/admin` ใน production ใช้ bootstrap แบบครั้งเดียวและบังคับเปลี่ยนรหัส
