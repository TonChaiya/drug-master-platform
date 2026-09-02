# แบบจำลองข้อมูลกลาง

นี่เป็น logical model สำหรับสร้าง Drizzle schema/migrations ไม่ใช่ SQL พร้อมรันทันที

## Identity and tenancy

- `facilities`: id, facilityCode(5), facilityName, status, timestamps
- `users`: id, facilityId nullable for central admin, username, fullName, positionName, passwordHash, role, status, mustChangePassword, lastLoginAt
- `sessions`: id/hash, userId, expiresAt, revokedAt, metadata
- `auditLogs`: actorUserId, effectiveFacilityId, action, entityType/id, before/after redacted JSON, request metadata, createdAt

ข้อบังคับ:

- `facilityCode` unique และ validated
- username unique แบบ normalized
- ผู้ใช้ `role=user` ต้องมี facility; central admin ต้องไม่มี facility
- ตาราง facility-owned ต้องมี `facilityId` โดยตรงและ index นำหน้า แม้สามารถ join หาได้ เพื่อให้ scope ชัดและตรวจ query ง่าย

## Source and standards

- `sourceDrugs`: facilityId + drugcode unique, local names, generic, drugtype, pack/unit/price/NDC fields, source timestamps, active, lastSeenSyncId
- `standardProducts`: standardCode unique, standardType(TMT/TTMT), activeIngredient, strength, dosageForm, content/unit, tradeName, manufacturer, FSN, status, rawNlem, exportIsed, registrationNumber, sourceVersion, sourceChangedAt
- `standardImports`: kind, version, file hash, counts, status, importedBy, timestamps
- `standardSyncRuns`: source, method, date window/cursor, counts, status, error code, timestamps

## Drug Catalog and mappings

- `drugCatalogImports`: facilityId, filename, contentHash, sourceVersion/date, row counts, importedBy, timestamps
- `drugCatalogRows`: importId, facilityId, 21 payload fields (ไม่มีคอลัมน์ลำดับ `#`), rowNumber; unique `(importId,HOSPDRUGCODE)`
- `drugMappings`: facilityId, sourceDrugId unique, standardCode, productCat, specPrep, export fields, updateFlag, date fields, source(`drug_catalog|manual`), catalogImportId, mappedBy, mappedAt, updatedAt

ไม่มี `approved`, `approvedBy` หรือ approval state ใน clean schema

## Agent

- `agentInstallations`: installationId(UUID), facilityId, machine label, status, lastSeenAt, agentVersion
- `agentCredentials`: installationId, public key id, encrypted secret, createdAt, revokedAt, lastUsedAt
- `agentEnrollmentTokens`: tokenHash, facilityId, createdBy, expiresAt, consumedAt
- `agentCommands`: installation/facility, type, payload, state, claim token, timestamps/result
- `agentSyncSessions`: installation/facility, declared officeId, expected/received rows, status, timestamps
- `agentSyncStaging`: sessionId, facilityId, drugcode + validated payload; unique `(sessionId,drugcode)`
- `agentRequestNonces`: credentialId + nonce unique, timestamp/expiry

Sync ใช้ staging แล้ว commit แบบ atomic หลังจำนวนแถวและ `officeId` ผ่าน ห้าม upsert ตารางจริงทีละ batch โดยไม่มี finalization

## Database portability

- ใช้ `utf8mb4`; เพิ่ม fixture ภาษาไทยใน migration test
- ใช้ `VARCHAR` + application validation สำหรับสถานะแทน DB enum ที่ย้ายยาก
- ระวัง JavaScript integer precision: serialize BIGINT identifiers เป็น string หรือใช้ `bigint` อย่างสม่ำเสมอ
- ไม่พึ่ง FULLTEXT/trigger/stored procedure/event
- ทุก unique key ของข้อมูลสถานบริการต้องรวม `facilityId` เช่น `(facilityId,drugcode)`
- index หลัก: facility+status, facility+drugcode, facility+mappedAt, standardType+status+code และ normalized search fields

