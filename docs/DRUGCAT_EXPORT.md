# Drug Catalog Import and Export

ตรวจจากไฟล์จริง `05957_drugcat_pass.xls`: ชีต `Sheet0`, คอลัมน์ `A:V`, หัวตารางแถว 1 ทั้งหมด 22 ช่อง การเขียนใหม่ต้องใช้ไฟล์แม่แบบที่อนุมัติโดยตรงและห้ามเปลี่ยนชื่อ/ลำดับ

## Locked headers

1. `#`
2. `HOSPDRUGCODE`
3. `PRODUCTCAT`
4. `TMTID`
5. `SPECPREP`
6. `GENERICNAME`
7. `TRADENAME`
8. `DFSCODE`
9. `DOSAGEFORM`
10. `STRENGTH`
11. `CONTENT`
12. `UNITPRICE`
13. `DISTRIBUTOR`
14. `MANUFACTURER`
15. `ISED`
16. `NDC24`
17. `PACKSIZE`
18. `PACKPRICE`
19. `UPDATEFLAG`
20. `DATECHANGE`
21. `DATEUPDATE`
22. `DATEEFFECTIVE`

## Import rules

- รองรับ `.xls`/`.xlsx` ตาม fixture ที่ยืนยัน; ตรวจ MIME/signature ไม่เชื่อ extension
- แถวข้อมูลเก็บ 21 payload fields โดยไม่ใช้ `#` เป็น identity
- reject หัวตารางผิดลำดับ, `HOSPDRUGCODE` ซ้ำในไฟล์, รหัสสถานบริการผิด scope และไฟล์ hash ซ้ำ
- เก็บ SHA-256, ชื่อไฟล์, version/source date, counts, ผู้นำเข้าและเวลา
- การ import ล่าสุดสร้าง comparison snapshot ใหม่ของ facility และ reconcile auto-map แบบ transaction/job ที่ retry ได้
- ไฟล์จริงเก็บ private object storage; parse ด้วย streaming/worker เมื่อใหญ่

## Mapping and PRODUCTCAT

ขอบเขตปัจจุบันที่ยืนยันจากระบบเดิม:

- drugtype `01` -> PRODUCTCAT `1` (commercial modern drug)
- drugtype `10` -> PRODUCTCAT `3` (commercial Thai/herbal drug)
- สินค้า commercial ให้ `SPECPREP` ว่าง

PRODUCTCAT `2`/`4` ต้องมี TP/GP-F/GP-X concept และกฎ SPECPREP แยก จึงอย่า map TPU เข้า category เหล่านี้เพื่อให้ผ่านชั่วคราว

## Export selection

- `all-mapped`: ทุก mapping ปัจจุบันของ facility
- `manual-changes`: เฉพาะ mapping source `manual` ที่ผู้ใช้สร้าง/แก้ไขในรอบที่เกี่ยวข้อง
- หน้าจอต้อง query และแสดงแถวจริงของชุดที่เลือกก่อนดาวน์โหลด พร้อมจำนวนตรงกับไฟล์
- admin ต้องเลือก effective facility อย่างชัดเจน; user ใช้ facility จาก session

## Field rules

- `GENERICNAME` จาก standard `activeingredient` (fallback ต้องมีเหตุผลและ test)
- `TRADENAME` จาก standard `tradename`
- `ISED` จาก normalized NLEM ตาม `TMT_API.md`
- `UPDATEFLAG=A` เมื่อ HOSPDRUGCODE ไม่อยู่ใน latest catalog; `E` เมื่อมีและแก้ไข
- วันส่งออกใช้ `dd/mm/yyyy`; เก็บ source timestamps เป็น UTC ใน DB
- ชื่อไฟล์ `{facilityCode}_drugcat_YYYYMMDD_HHmmss.xls`

## Export implementation gate

ไลบรารี Node ที่เลือกต้องอ่าน/เขียน BIFF8 `.xls` โดยรักษา workbook template ได้จริง หากทำไม่ได้ ห้ามเปลี่ยนเป็น `.xlsx` เอง ให้ใช้ isolated export service/runtime ที่รองรับและทดสอบ byte/file-open contract แทน

Automated contract test ต้องตรวจ:

- ชนิดไฟล์เปิดได้ด้วย Excel/LibreOffice
- sheet name และหัว 22 ช่องตรงทุกตัว
- จำนวน/ลำดับแถวตรง preview และ facility scope
- รหัสที่มีเลขศูนย์นำหน้าไม่ถูกแปลงเป็น number
- ภาษาไทยไม่เสีย
- วันที่/ISED/UPDATEFLAG/PRODUCTCAT ถูกต้อง

