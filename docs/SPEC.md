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
- Agent ต้องมี installation identity ระดับเครื่องที่คงเดิมเมื่อ upgrade/reinstall และ re-enroll เครื่องเดิมต้องใช้ canonical installation identity เดิม
- MAC address และ IP address เป็น telemetry เพื่อช่วยตรวจสอบเท่านั้น ไม่ใช่ primary identity และห้ามใช้ auto-merge Agent
- สถานะ Registration, Presence, Credential และ JHCIS ต้องแยกจากกัน เพื่อไม่ให้ online หรือ key ที่ active กลบสถานะ disabled/superseded หรือ JHCIS unreachable
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
- ผู้ใช้ยืนยัน `needs_review` ได้เฉพาะ state ที่ตรวจจริง โดยผูกกับ `drugMappings.updatedAt` และสถานะ present/TMT ของ catalog ล่าสุด; เมื่อ mapping หรือ state ที่เกี่ยวข้องเปลี่ยน acknowledgement เดิมจะ stale และกลับเป็น `needs_review`
- การบันทึก mapping ปกติไม่ยืนยัน review อัตโนมัติ และ confirm-only ห้ามเปลี่ยน version ของ mapping

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

**TMT/TTMT Data Model v2 requirement**

- TMT และ TTMT เป็นคนละ domain/namespace; รหัสเหมือนกันต้องอยู่ร่วมกันได้โดยไม่ชนกัน
- ตาราง source ของ TMT ต้องสะท้อนชื่อ endpoint ในคู่มือแบบ singular ตามที่อนุมัติ: `tmt_subs`, `tmt_vtm`, `tmt_gp`, `tmt_gpu`, `tmt_gpp`, `tmt_tp`, `tmt_tpu`, `tmt_tpp`, `tmt_nlem`, `tmt_atc`, `tmt_regno`, `tmt_mastertmt`, `tmt_concept`, `tmt_relationship`, `tmt_version`
- TTMT ใช้ contract จากไฟล์ MasterTTMT ที่อนุมัติเท่านั้น ห้ามสร้าง hierarchy/API แบบ TMT โดยไม่มีหลักฐาน
- commercial TMT mapping ต้องอ้างระดับที่ eligible ตามชนิดสินค้าและ raw source status; สำหรับ PRODUCTCAT `1` เป้าหมายต้องเป็น TPU ที่ `status=0` ส่วน GPU/TP/ระดับอื่นแสดงเพื่ออธิบายได้แต่ห้ามบันทึกแทน TPU
- TMT Browser ต้องแสดง level ด้วยสีและ text badge พร้อมกัน: GP สีแดง, GPU สีเขียว, TP สีเหลือง, TPU สีน้ำเงิน; ห้ามใช้สีเพียงอย่างเดียว ส่วนสี SUBS/VTM/GPP/TPP ยังไม่กำหนด
- TMT Browser v2 เป็น read-only preview: exact/prefix/normalized-FSN search ได้ทุก level, แสดง inbound/outbound ตาม API `concept1 -> concept2`, conflict หลายค่าต้องแสดงทั้งหมด และ graph ต้องจำกัด depth/node พร้อม cycle protection
- commercial mapping eligibility preview ใช้กฎที่อนุมัติเท่านั้น: TPU ต้องมี MasterTMT `status=0`; GPU/ระดับอื่น, cancelled หรือสถานะไม่ทราบต้องไม่แสดงว่าพร้อม และ Phase 4 ห้ามบันทึก mapping

Implementation status ของข้อกำหนดนี้อยู่ใน `PROJECT_STATUS.md`; การมี schema foundation ไม่ได้แปลว่า production cutover แล้ว

**แหล่งยาและ catalog**

- `sourceDrugs`: facilityId + drugcode unique, ชื่อท้องถิ่น, generic, drugtype, pack/unit/price/NDC, active, lastSeenSyncId
- `drugCatalogImports`: facilityId, filename, contentHash, sourceVersion/date, row counts, importedBy, timestamps
- `drugCatalogRows`: importId, facilityId, 21 payload fields (ไม่มีคอลัมน์ลำดับ `#`), rowNumber; unique `(importId, HOSPDRUGCODE)`
- `drugMappings`: facilityId, sourceDrugId unique ต่อ facility, standardCode และ identity v2 nullable `(standardSource, standardCode, standardLevel)`, productCat, specPrep, ฟิลด์ส่งออก, updateFlag, ฟิลด์วันที่, source(`drug_catalog|manual`), catalogImportId, mappedBy, mappedAt, updatedAt
- `mappingExportCheckpoints`: facilityId + mappingId, mappingUpdatedAt, exportId, exportedAt; เก็บ version ล่าสุดของแต่ละ mapping ที่ส่งออกสำเร็จ
- `mappingReviewAcknowledgements`: current row ต่อ facilityId + mappingId, mappingUpdatedAt, catalog present/TMT/import, confirmedBy/At; history การยืนยันอยู่ใน `auditLogs`
- `exportPreviewTokens`: tokenHash, facilityId, selection, snapshotHash, expiresAt, consumedAt; token สุ่มใช้ได้ครั้งเดียวและเก็บเฉพาะ hash

**Agent**

- `agentInstallations`: installationId(UUID), facilityId, machine label, declaredOfficeId, status, lastSeenAt,
  lastHeartbeatAt, JHCIS state/check time, MAC/IP telemetry, supersededByInstallationId, agentVersion
- `agentCredentials`: installationId, public key id, encrypted secret, createdAt, revokedAt, lastUsedAt,
  supersededByCredentialId สำหรับ revoke key เก่าหลัง key ใหม่พิสูจน์ตัวเอง
- `agentEnrollmentTokens`: tokenHash, facilityId, createdBy, expiresAt, consumedAt, targetInstallationId nullable
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

### Mapping identity v2 (dormant until approved cutover)

- `standard_source` เป็น `TMT` หรือ `TTMT`; `standard_code` เป็น string และ `standard_level` เป็น level ที่ source ยืนยัน (`tpu` สำหรับ commercial TMT, `product` สำหรับ TTMT).
- Legacy rows ที่ source/level เป็น `NULL` เป็น state ที่ยังไม่ cutover: ห้ามเดา namespace จากตัวเลข code.
- PRODUCTCAT 1 ใช้ได้เฉพาะ TMT TPU ที่มี `tmt_concept.level_name=tpu` และ `tmt_mastertmt.status=0`; GPU/GP/TP แสดงเพื่ออธิบายได้แต่บันทึกไม่ได้.
- TTMT ตรวจ `ttmt_products` และ import ที่สำเร็จตาม contract ของ TTMT โดยไม่ใช้ TMT hierarchy.
- PRODUCTCAT 2/4 ยังปฏิเสธจนกว่าจะมีกฎ TP/GP-F/GP-X ที่ยืนยันได้.
- การเปลี่ยน source/code/level เป็น mapping write จึงทำให้ review acknowledgement ที่ผูก `updatedAt` เดิม stale โดยอัตโนมัติ.

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

**TMT v2 sync invariants** — full run เริ่ม `2013-01-01`, window deterministic ไม่เกิน 365 วัน และ checkpoint แยก endpoint; incremental ใช้ latest successful cursor ของแต่ละ endpointพร้อม overlap 30 วัน การ replay ต้อง idempotentและห้าม prune/deactivate จาก absence

run ต้องผูก `/version` ก่อนและหลัง; version drift ทำให้ run stale ห้าม publish core readiness Retry timeout/network/429/5xx สูงสุด 3 attempts และ refresh tokenหลัง 401/403 ได้ครั้งเดียว Core readiness ต้องครบ SUBS/VTM/GP/GPU/GPP/TP/TPU/TPP/NLEM/RegNo/MasterTMT/Concept/Relationship; ATC และ ImageList failure เป็น warning ส่วน Image ใช้ on-demand เท่านั้น

เมื่อ `/version` คืนค่าว่าง อนุญาตเฉพาะ operational mode `full-unverified` ที่ระบุชัดเจนและเริ่มจาก TMT v2 source/run/checkpoint/version tables ว่างทั้งหมดเท่านั้น mode นี้ต้องสร้าง run/checkpoint ใหม่, ใช้ marker `unverified:<run-id-prefix>` แทน version, ห้ามสร้าง version observation และห้าม resume หลัง process หยุด. Core 13 endpoints และ ATC เป็น required แบบ one-shot; ImageList retry/checkpoint ตามปกติแต่ failure เป็น optional warning เพราะไม่เป็น input ของ hierarchy, mapping/export หรือ blocking invariants. เมื่อ required data และ invariant ผ่านให้จบด้วยสถานะ `unverified` และ `coreReady=false`; ห้ามใช้ผลนี้เปิด feature flags หรือปิด maintenance โดยไม่มี approval แยก. Full/incremental/resume ปกติยังต้องใช้ `/version` ที่ไม่ว่างและ resume ต้องตรงกับ pinned version เสมอ.

**TTMT** — คู่มือ API ไม่ยืนยัน MasterTTMT endpoint ระบบจึงนำเข้า MasterTTMT จากไฟล์ที่อนุมัติ
และแยก version/import history ของ TTMT ออกจาก TMT API **ห้ามถือว่าเป็นข้อมูลเดียวกัน**

TTMT v2 importer ใช้ known MasterTTMT column aliases เดียวกับ legacy parser แต่ duplicate identity ในไฟล์ต้อง reject, import/version และ hash ต้อง unique และ import + product upsert + audit ต้อง commit ใน transaction เดียวกัน ข้อมูล v2 เขียนได้เฉพาะ `ttmt_imports`/`ttmt_products`; ห้าม fallback ไป `standard_products` หรือ TMT hierarchy. Dry-run parse/hash/summary เท่านั้นและต้องเขียน 0 แถว.

**Phase 7 maintenance boundary** — สถานะเก็บแบบ persistent/encrypted ใน `app_settings`. เมื่อ ON ทุก domain mutation ที่เปลี่ยน source/catalog/mapping/review/export/sync, Agent command state หรือ facility business data ต้องถูกปฏิเสธหลัง authentication แต่ก่อน service write ด้วย HTTP 503; read-only/login/admin และ guarded operational tooling ยังใช้ได้. สถานะอ่านไม่ได้ต้อง fail closed สำหรับ domain mutation. การ enable/disable ที่เปลี่ยน state จริงต้อง audit และ same-state เป็น no-op.

**Controlled reset** — ใช้ exact table allowlist และ transaction เท่านั้น ห้าม wildcard/drop และห้ามแตะ users/facilities/sessions/app settings/audit/Agent identity+credentials+commands+tokens/rate limits/migration journal. Dry-run เป็น default; execution ต้องมี maintenance ON, verified backup reference, explicit mode/execute และ exact database confirmation. โหมด `tmt-v2-only` ลบได้เฉพาะ 17 ตาราง TMT source/run/checkpoint/version ที่ระบุไว้ และต้อง preserve business mapping/catalog/source/export, TTMT และ legacy `standard_*`.

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

- `all-mapped`: ทุก mapping ปัจจุบันที่มีสถานะ `mapped` และมาตรฐานยัง valid
- `manual-changes`: เฉพาะ mapping ที่ `mapped`/valid และยังไม่เคยส่งออก หรือ `updatedAt` เปลี่ยนจาก version ที่ส่งออกสำเร็จล่าสุด
- ทั้ง full export และ delta ต้อง checkpoint เฉพาะแถวที่อยู่ในไฟล์หลังสร้างไฟล์สำเร็จ; export ที่ล้มเหลวห้ามเปลี่ยน checkpoint
- checkpoint แยกตาม facility และ `pending`/`needs_review` ห้ามอยู่ในไฟล์
- หน้าจอต้องแสดงแถวจริงของชุดที่เลือกก่อนดาวน์โหลด พร้อมจำนวนที่ตรงกับไฟล์; preview token มีอายุ 10 นาที ใช้ได้ครั้งเดียว และถ้าข้อมูลเปลี่ยนหลัง preview ให้ยกเลิก download แล้วขอให้ตรวจ preview ใหม่
- admin ต้องเลือก effective facility อย่างชัดเจน; user ใช้ facility จาก session

### Mapping v2 consumer และ export

- identity มาตรฐานต้องเป็น tuple `(standard_source, standard_code, standard_level)`; รหัสตัวเลขเดียวกันของ TMT และ TTMT เป็นคนละ namespace และห้าม fallback ข้าม source
- PRODUCTCAT 1 ส่งออกได้เฉพาะ `TMT / <code> / tpu` ที่มี active MasterTMT (`status=0`); GPU/GP/TP, missing MasterTMT และ inactive TPU ต้อง fail closed
- Drug Catalog `TMTID` เทียบกับ final mapped code โดยตรง ไม่ traverse graph เพื่อเปลี่ยน GPU เป็น TPU อัตโนมัติ ตัวอย่าง GPU `764169` ใช้เป็น mapping/export ไม่ได้ แต่เมื่อผู้ใช้เลือก TPU `565818` ค่า export ต้องเป็น `565818`
- TMT export fields มาจาก MasterTMT; ISED มาจาก distinct latest-date NLEM เท่านั้น ถ้าค่า unknown หรือ latest-date conflict ให้ ISED ว่างพร้อม warning ห้ามเดา
- latest-date RegNo หลายค่าต้องคงเป็น conflict และห้ามเลือก first/alphabetical ปัจจุบัน RegNo ไม่อยู่ใน DrugCat 22 ช่องจึงเป็น warning และไม่ block export
- ATC ไม่อยู่ใน DrugCat 22 ช่อง ดังนั้น ATC conflict ไม่ block export และ export adapter ไม่ต้อง query ATC
- TTMT mapping resolve จาก `ttmt_products` ของ succeeded import เท่านั้น ใช้ status/fields ของ TTMT โดยตรง ห้าม query TMT graph, MasterTMT หรือ enrichment ของ TMT
- mapping v2 export-ready เมื่อ lifecycle เป็น `mapped`, acknowledgement (ถ้าต้องใช้) ยัง current, source-specific standard valid และไม่มี conflict ที่ทำให้คอลัมน์ contract กำกวม
- delta/checkpoint ใช้ version จาก `drug_mappings.updatedAt`; การ refresh metadata ของ TMT/TTMT เพียงอย่างเดียวห้ามทำให้ mapping กลับเข้า delta
- preview hash ต้องรวม source/code/level เพื่อให้ token stale เมื่อ identity เปลี่ยน และ failed export ห้ามเลื่อน checkpoint
- v2 Browser/Mapping/Catalog/Export เปิดใช้เฉพาะ feature flag explicit และ latest TMT run ต้อง `status=succeeded` โดยไม่ใช่ `full_unverified`; run ที่ missing/unverified/failed/stale/running ต้อง fail closed ด้วย `TMT_V2_NOT_READY`. เมื่อ flag ปิดต้องใช้ legacy resolver เดิมและไม่ query v2 tables

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
