# TMT API Contract

อ้างอิงจาก `tmtapi_manual.pdf` ในระบบเดิม (เอกสาร 26 หน้า) เอกสารนี้บันทึกเฉพาะ endpoint/field ที่ตรวจพบ ไม่เติมค่าที่ API ไม่ได้ให้

## Authentication

- `POST https://tmt.this.or.th/tmtapi/token`
- body JSON มี `username`, `password`
- response มี `create`, `expire`, `token`
- endpoint อื่นใช้ `Authorization: Bearer <token>` โดยไม่ encode token
- TLS verification ต้องเปิดใน production

Credential เป็น server-only secret และค่าที่เคยเผยแพร่ในข้อความ/ไฟล์ต้อง rotate ก่อนใช้งานจริง

## Endpoint ที่เกี่ยวข้อง

- `/mastertmt`: `tpucode`, `activeingredient`, `strength`, `dosageform`, `contvalue`, `contunit`, `dispunit`, `tradename`, `manufacturer`, `fsn`, `status`
- `/nlem`: `tpuid`, `fsn`, `nlem`, `change_date`
- `/regno`: `tpuid`, `fsn`, `regno`, `change_date`
- `/tpu`: `tpuid`, `fsn`, `manufacturer`, `change_date`
- `/version`: `tmt_version`
- คู่มือยังระบุ `/subs`, `/vtm`, `/gp`, `/gpu`, `/gpp`, `/tp`, `/tpp`, `/imagelist`, `/image`, `/atc`, `/concept`, `/relationship`

การ sync แบบช่วงวันที่ใช้ `begindate` และ `enddate`; แบ่งช่วงไม่เกินหนึ่งปีเป็น implementation safety rule เพื่อ retry/ตรวจจำนวนง่าย ไม่ใช่การเดาว่า API บังคับเสมอ

## การประกอบข้อมูลที่ถูกต้อง

`/mastertmt` ไม่มี ISED และเลขทะเบียนยา จึงต้อง enrich โดย join:

```text
mastertmt.tpucode = nlem.tpuid = regno.tpuid
```

- generic name ใช้ `mastertmt.activeingredient`
- trade name ใช้ `mastertmt.tradename`
- manufacturer ใช้ `mastertmt.manufacturer`
- registration number ใช้ `regno.regno`
- ค่า ISED มาจาก `nlem.nlem` เท่านั้น

Normalization สำหรับ export:

| NLEM raw | ISED |
|---|---|
| `ED` | `E` |
| `ED*` | `E*` |
| `NED` | `N` |

ค่าอื่น/ว่างให้เก็บ raw, ตั้ง export ISED ว่างและแสดง data-quality warning ห้ามคาดเดา

`status=0` คือ active และ `status=1` คือ inactive ตามคู่มือ MasterTMT; manual mapping เลือกได้เฉพาะ active

## Version and initial sync

- เรียก `/version` และเก็บ version พร้อมเวลา/hash/count ของ sync
- ครั้งแรกแบ่ง date windows/cursor เป็นงานย่อยที่ retry ได้และ deduplicate ด้วย primary key + source change date
- งานถือว่าสำเร็จเมื่อครบทุก partition และ reconciliation count ผ่านเท่านั้น
- token cache อยู่ใน memory หรือ encrypted DB; ห้ามเขียนไฟล์ local ของ function

## TTMT

คู่มือ API ชุดนี้ไม่ยืนยัน MasterTTMT endpoint ดังนั้นระบบต้องนำเข้า MasterTTMT จากไฟล์ที่อนุมัติและแยก version/import history ของ TTMT ออกจาก TMT API ห้ามถือว่า TTMT เป็นข้อมูลเดียวกับ TMT โดยไม่มีเอกสารใหม่รองรับ

