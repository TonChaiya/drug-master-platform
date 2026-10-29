# ข้อกำหนดระบบ (SPEC)

เอกสารนี้คือ source of truth ว่าระบบ **ต้องทำอะไร** หากโค้ดขัดกับเอกสารนี้ให้ยึดเอกสาร และบันทึกข้อขัดแย้งใน pull request
เรื่อง **ระบบทำงานอย่างไร** อยู่ใน [OPERATIONS.md](OPERATIONS.md)

---

## 1. ผู้ใช้และสถานบริการ

- สมัครสมาชิกเก็บ: ชื่อ-สกุล, ตำแหน่ง, ชื่อสถานบริการ, รหัสสถานบริการ 5 หลัก, user ID และ password
- บัญชีใหม่เป็น `user` และ `pending` เสมอ ต้องให้ admin เปิดใช้งานก่อน login
- หลังสมัครสำเร็จแสดงว่า "สมัครสมาชิกสำเร็จ กรุณาติดต่อผู้พัฒนาเพื่ออนุมัติไอดี"
- รหัสสถานบริการต้องเป็นเลข 5 หลักและห้ามเป็นรูป `0000x`
- ผู้ใช้หลายคนในรหัสสถานบริการเดียวกันทำงานบน dataset กลุ่มเดียวกัน
- `user` อ่าน/แก้ได้เฉพาะ facility ของตน ห้ามเลือกหรือส่ง `facilityId` เพื่อข้ามขอบเขต
- admin กลางมี `facilityId = null` ดู dashboard/ประวัติได้ทุกแห่ง เลือก facility เพื่อปฏิบัติงาน และลบ/ล้าง mapping ได้พร้อม audit log
- admin ห้ามถูกบันทึกเป็นสมาชิกของสถานบริการโดยอัตโนมัติ
- การปิดใช้งานบัญชีต้องยกเลิก session ที่เปิดค้างอยู่ทันที

## 2. แหล่งยา JHCIS

- อ่านจาก `cdrug` เฉพาะ `drugflag='1'` และ `drugtype IN ('01','10')` — ไม่ใช้ `drugtype='05'`
- ห้ามใช้ TMT/TTMT เดิมใน JHCIS เป็นคำตอบโดยตรง ทุกครั้งต้องตรวจด้วย DrugCat/ฐานมาตรฐานใหม่
- Agent ต้องอ่าน `office.offid` และยอม sync เมื่อ offid ตรงกับ facility ที่ enrollment เท่านั้น
- ฐาน JHCIS เป็น read-only ระบบนี้ห้ามเขียนกลับ
- เอกลักษณ์ยาท้องถิ่นคือ `(facilityId, drugcode)` ไม่ใช่ `drugcode` เดี่ยว
- แถวที่ไม่ถูกส่งมาในรอบ sync ล่าสุดถือว่าไม่ active แล้ว

## 3. ลำดับเตรียมข้อมูลและ map

1. รับยา 01/10 จาก JHCIS
2. sync MasterTMT พร้อม NLEM/ทะเบียนยา และนำเข้า MasterTTMT
3. นำเข้า Drug Catalog ปัจจุบันของสถานบริการ
4. เทียบ `HOSPDRUGCODE` กับ `drugcode` และตรวจชนิดมาตรฐาน
5. ถ้ารหัสและมาตรฐานตรงและ active ให้ auto-map ถ้าไม่ตรง/ไม่พบให้รอ manual map
6. manual map จากคลังมาตรฐานที่ active และตรงชนิด
7. บันทึกสำเร็จแล้วพร้อม export ทันที **ไม่มี approval workflow**

ชนิดมาตรฐาน: `drugtype 01` ใช้ TMT · `drugtype 10` ใช้ TTMT

**สถานะ Mapping จาก Drug Catalog snapshot ล่าสุด**

- `mapped`: มี mapping ที่ valid/current และไม่ขัดกับ snapshot ล่าสุด
- `needs_review`: ยา active เคยอยู่ใน catalog แต่หายจาก snapshot ล่าสุด, แถวล่าสุดไม่มี TMT/TTMT หรือ TMT/TTMT เปลี่ยนแต่ mapping ปัจจุบันมาจาก manual
- `pending`: ยา active ไม่เคยอยู่ใน catalog และยังไม่มี mapping
- ถ้า TMT/TTMT เปลี่ยน mapping ที่มี source `drug_catalog` ต้องตาม snapshot ล่าสุด แต่ source `manual` ห้ามถูกทับ
- ยา inactive ที่หายจาก snapshot ล่าสุดเก็บ history ไว้และไม่ขึ้น worklist
- ห้ามลบ snapshot, mapping หรือ history เดิมอัตโนมัติจากการ reconcile

## 4. PRODUCTCAT และ SPECPREP

- drugtype `01` → PRODUCTCAT `1` (ยาแผนปัจจุบัน ผลิตภัณฑ์ทางการค้า)
- drugtype `10` → PRODUCTCAT `3` (ยาแผนไทย/สมุนไพร ผลิตภัณฑ์ทางการค้า)
- สินค้า commercial ต้องเว้น `SPECPREP` ว่าง
- PRODUCTCAT `2`/`4` (ผลิต/ปรุง/แบ่งบรรจุใช้เอง) ต้องมี concept TP/GP-F/GP-X และกฎ SPECPREP แยก
  **ห้าม map TPU เข้าหมวดเหล่านี้เพื่อให้ผ่านชั่วคราว** ระบบต้องปฏิเสธ

## 5. UPDATEFLAG

- `A`: `HOSPDRUGCODE` ไม่มีใน Drug Catalog ล่าสุดของ facility นั้น เป็นรายการใหม่
- `E`: มี `HOSPDRUGCODE` ในไฟล์ล่าสุด แต่ผู้ใช้แก้/เปลี่ยน mapping หรือข้อมูลส่งออก
- ถ้ายังไม่เคยนำเข้าไฟล์เลย ทุกรายการเป็น `A`
- ตัดสินจาก snapshot ไฟล์ล่าสุดของ facility เดียวกันเท่านั้น **ห้ามเทียบข้าม facility**

## 6. การค้นหาและหน้าจอ

- ค้นมาตรฐานด้วยตัวกรองอิสระ 5 ช่อง: รหัส TMT/TTMT, trade name, generic name, manufacturer, registration number
- พิมพ์อย่างน้อย 2 ตัวอักษรในตัวกรองข้อความ และ debounce; ผลลัพธ์ที่มาช้ากว่าต้องไม่ทับผลใหม่
- ปุ่มล้างต้องไม่ reload หน้า
- หน้าหลักแสดง readiness 3 รายการแบบเล็ก: JHCIS, Drug Catalog, TMT/TTMT พร้อม version/เวลา
  พร้อม = เขียว; ยังไม่พร้อม = แดงและมี action ไปยังงานที่ต้องตั้งค่า
- การตั้งค่า/ทดสอบ/ดึงข้อมูลของแหล่งเดียวกันอยู่หน้าเดียวตามลำดับ
- ประวัติ admin เป็นแถวยาวต่อสถานบริการ: รหัส, ชื่อ, จำนวนจาก JHCIS, mapped, คงค้าง กดแล้วค่อยดูรายละเอียด
- mutation ใช้ async feedback และรักษาตำแหน่ง/ตัวกรอง ห้าม full-page reload ในงานปกติ

---

## 7. แบบจำลองข้อมูล

Logical model สำหรับสร้าง Drizzle schema/migrations

**Identity และ tenancy**

- `facilities`: id, facilityCode(5), facilityName, status, timestamps
- `users`: id, facilityId (null สำหรับ admin กลาง), username, fullName, positionName, passwordHash, role, status, mustChangePassword, lastLoginAt
- `sessions`: id, tokenHash, userId, expiresAt, revokedAt, metadata
- `auditLogs`: actorUserId, effectiveFacilityId, action, entityType/id, before/after JSON ที่ redact แล้ว, request metadata, createdAt

**มาตรฐาน**

- `standardProducts`: standardCode unique, standardType(TMT/TTMT), activeIngredient, strength, dosageForm, content/unit, tradeName, manufacturer, FSN, status, rawNlem, exportIsed, registrationNumber, sourceVersion, sourceChangedAt, และคอลัมน์ normalized สำหรับค้นหา
- `standardImports`: kind, version, file hash, counts, status, importedBy, timestamps
- `standardSyncRuns`: source, method, date window/cursor, counts, status, error code, timestamps

**แหล่งยาและ catalog**

- `sourceDrugs`: facilityId + drugcode unique, ชื่อท้องถิ่น, generic, drugtype, pack/unit/price/NDC, active, lastSeenSyncId
- `drugCatalogImports`: facilityId, filename, contentHash, sourceVersion/date, row counts, importedBy, timestamps
- `drugCatalogRows`: importId, facilityId, 21 payload fields (ไม่มีคอลัมน์ลำดับ `#`), rowNumber; unique `(importId, HOSPDRUGCODE)`
- `drugMappings`: facilityId, sourceDrugId unique ต่อ facility, standardCode, productCat, specPrep, ฟิลด์ส่งออก, updateFlag, ฟิลด์วันที่, source(`drug_catalog|manual`), catalogImportId, mappedBy, mappedAt, updatedAt

**Agent**

- `agentInstallations`: installationId(UUID), facilityId, machine label, declaredOfficeId, status, lastSeenAt, agentVersion
- `agentCredentials`: installationId, public key id, encrypted secret, createdAt, revokedAt, lastUsedAt
- `agentEnrollmentTokens`: tokenHash, facilityId, createdBy, expiresAt, consumedAt
- `agentCommands`: installation/facility, type, payload, state, claim token, idempotency key, expiry, timestamps/result
- `agentSyncSessions`: installation/facility, declared officeId, expected/received rows, status, timestamps
- `agentSyncStaging`: sessionId, facilityId, drugcode + payload ที่ validate แล้ว; unique `(sessionId, drugcode)`
- `agentRequestNonces`: credentialId + nonce unique, expiry

**ข้อบังคับของ schema**

- ไม่มี `approved`, `approvedBy` หรือ approval state ใด ๆ
- ตาราง facility-owned ต้องมี `facilityId` โดยตรงและ index นำหน้า แม้จะ join หาได้ เพื่อให้ตรวจ query ง่าย
- ทุก unique key ของข้อมูลสถานบริการต้องรวม `facilityId`
- ใช้ `utf8mb4`; ใช้ `VARCHAR` + application validation แทน DB enum
- เวลาเก็บ UTC แสดงผล `Asia/Bangkok`
- ไม่พึ่ง FULLTEXT / trigger / stored procedure / event
- Sync ใช้ staging แล้ว commit แบบ atomic หลังจำนวนแถวและ `officeId` ผ่าน ห้าม upsert ตารางจริงทีละ batch

---

## 8. TMT API

**Authentication** — `POST {base}/token` body `{username, password}` ตอบ `{create, expire, token}`
endpoint อื่นใช้ `Authorization: Bearer <token>` โดยไม่ encode token · TLS verification ต้องเปิดใน production
Credential เป็น server-only secret และค่าที่เคยเผยแพร่ต้อง rotate ก่อนใช้งานจริง
token cache อยู่ใน memory หรือ encrypted DB **ห้ามเขียนไฟล์ local ของ function**

**Endpoint ที่ใช้**

- `/mastertmt`: `tpucode`, `activeingredient`, `strength`, `dosageform`, `contvalue`, `contunit`, `dispunit`, `tradename`, `manufacturer`, `fsn`, `status`
- `/nlem`: `tpuid`, `fsn`, `nlem`, `change_date`
- `/regno`: `tpuid`, `fsn`, `regno`, `change_date`
- `/version`: `tmt_version`

**การประกอบข้อมูล** — `/mastertmt` ไม่มี ISED และเลขทะเบียนยา จึงต้อง enrich โดย join
`mastertmt.tpucode = nlem.tpuid = regno.tpuid`

- generic name ← `mastertmt.activeingredient`
- trade name ← `mastertmt.tradename`
- manufacturer ← `mastertmt.manufacturer`
- registration number ← `regno.regno`
- ISED มาจาก `nlem.nlem` **เท่านั้น**

**Normalization ของ ISED**

| NLEM raw | ISED |
|---|---|
| `ED` | `E` |
| `ED*` | `E*` |
| `NED` | `N` |

ค่าอื่นหรือว่าง: เก็บ raw ไว้ ตั้ง export ISED ว่าง และแสดง data-quality warning **ห้ามคาดเดา**

`status=0` คือ active, `status=1` คือ inactive · manual mapping เลือกได้เฉพาะ active

**Version และ initial sync** — เรียก `/version` เก็บ version พร้อมเวลา/hash/count
ครั้งแรกแบ่งเป็น date window ไม่เกินหนึ่งปีต่อรอบ เพื่อให้ retry และนับ reconciliation ต่อ partition ได้
งานถือว่าสำเร็จเมื่อครบทุก partition เท่านั้น

**TTMT** — คู่มือ API ไม่ยืนยัน MasterTTMT endpoint ระบบจึงนำเข้า MasterTTMT จากไฟล์ที่อนุมัติ
และแยก version/import history ของ TTMT ออกจาก TMT API **ห้ามถือว่าเป็นข้อมูลเดียวกัน**

---

## 9. Drug Catalog: นำเข้าและส่งออก

ตรวจจากไฟล์จริง: ชีต `Sheet0`, คอลัมน์ `A:V`, หัวตารางแถว 1 ทั้งหมด 22 ช่อง **ห้ามเปลี่ยนชื่อหรือลำดับ**

### หัวตารางที่ล็อกไว้

`#` · `HOSPDRUGCODE` · `PRODUCTCAT` · `TMTID` · `SPECPREP` · `GENERICNAME` · `TRADENAME` · `DFSCODE` ·
`DOSAGEFORM` · `STRENGTH` · `CONTENT` · `UNITPRICE` · `DISTRIBUTOR` · `MANUFACTURER` · `ISED` · `NDC24` ·
`PACKSIZE` · `PACKPRICE` · `UPDATEFLAG` · `DATECHANGE` · `DATEUPDATE` · `DATEEFFECTIVE`

### กฎการนำเข้า

- รองรับ `.xls`/`.xlsx` โดยตรวจ MIME/ลายเซ็นไฟล์ **ไม่เชื่อนามสกุล**
- แถวข้อมูลเก็บ 21 payload fields โดยไม่ใช้ `#` เป็น identity
- reject: หัวตารางผิดลำดับ, `HOSPDRUGCODE` ซ้ำในไฟล์, แถวที่ไม่มี `HOSPDRUGCODE`, ไฟล์ที่ hash ซ้ำกับที่เคยนำเข้า
- เก็บ SHA-256, ชื่อไฟล์, version/source date, counts, ผู้นำเข้าและเวลา
- การ import ล่าสุดสร้าง verified snapshot ใหม่ของ facility และเป็น reference ปัจจุบัน โดยเก็บ snapshot เก่าทั้งหมด
- เทียบ `HOSPDRUGCODE` กับ `source_drugs.drugcode`; จำนวนแถวในไฟล์อาจมากกว่า Agent ได้ตามปกติเพราะรวมรายการที่ active และเลิกใช้

### ชุดข้อมูลที่ส่งออกได้

- `all-mapped`: ทุก mapping ปัจจุบันของ facility
- `manual-changes`: เฉพาะ mapping ที่ source เป็น `manual`
- หน้าจอต้องแสดงแถวจริงของชุดที่เลือกก่อนดาวน์โหลด พร้อมจำนวนที่ตรงกับไฟล์
- admin ต้องเลือก effective facility อย่างชัดเจน; user ใช้ facility จาก session

### ที่มาของแต่ละคอลัมน์

- `GENERICNAME` ← standard `activeIngredient`
- `TRADENAME` ← standard `tradeName`
- `ISED` ← normalized NLEM
- `UPDATEFLAG` ← กฎข้อ 5
- วันส่งออกรูปแบบ `dd/mm/yyyy`; source timestamps เก็บ UTC ใน DB
- ชื่อไฟล์ `{facilityCode}_drugcat_YYYYMMDD_HHmmss.xls` (เวลา Asia/Bangkok)

### การอ่าน/เขียนไฟล์ Excel

ระบบ**ไม่ใช้ไลบรารี Excel จากภายนอก** เขียนเองใน `src/lib/excel/` เพราะสัญญาไฟล์นี้เป็นข้อผูกมัดที่ต้องพิสูจน์ได้แน่นอน
และควบคุมทุกไบต์เองตรวจสอบง่ายกว่าไลบรารีอเนกประสงค์ ใช้เพียง `node:zlib` ที่มากับ Node

| โมดูล | หน้าที่ |
|---|---|
| `cfb-reader.ts` / `cfb-writer.ts` | คอนเทนเนอร์ OLE2 (Compound File) ที่ห่อ BIFF8 |
| `biff-reader.ts` / `biff-writer.ts` | เรคอร์ด BIFF8: SST, LABELSST, NUMBER, RK, BLANK, FORMULA |
| `zip-reader.ts` / `xlsx-reader.ts` | อ่าน `.xlsx` (ZIP + XML) |
| `dates.ts` | serial วันที่ระบบ 1900 รวมการชดเชย 29 ก.พ. 1900 ที่ไม่มีจริง |
| `workbook.ts` | ตรวจชนิดไฟล์จากลายเซ็นและเลือกตัวอ่าน |

**กฎการเขียนไฟล์** — ทุกคอลัมน์รหัสเขียนเป็นข้อความ (number format `@`) เพื่อไม่ให้เลขศูนย์นำหน้าหายและ
NDC24 24 หลักไม่ถูกปัดเป็น float · มีเพียง `#` ที่เป็นตัวเลข · `DATECHANGE`/`DATEUPDATE`/`DATEEFFECTIVE`
เป็นชนิดวันที่จริงรูปแบบ `dd/mm/yyyy` · วันที่ที่ไม่มีค่าให้เว้นว่าง ห้ามเดาค่าแทน

แม่แบบเปล่าที่อนุมัติอยู่ที่ `references/templates/drugcat_blank_template.xls` (หัวตาราง 22 ช่อง ไม่มีข้อมูลจริง)
ใช้เป็นหลักฐานอ้างอิงเมื่อมีข้อสงสัยว่ารูปแบบเปลี่ยนไปหรือไม่

**สิ่งที่ต้องยืนยันทุกครั้งที่แตะโค้ด Excel** — เปิดไฟล์ผลลัพธ์ด้วย Excel/LibreOffice จริง แล้วตรวจ:
sheet name และหัว 22 ช่องตรงทุกตัว · จำนวน/ลำดับแถวตรงกับ preview · เลขศูนย์นำหน้าอยู่ครบ ·
NDC24 ไม่เพี้ยน · ภาษาไทยไม่เสีย · วันที่/ISED/UPDATEFLAG/PRODUCTCAT ถูกต้อง
