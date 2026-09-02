# Legacy Traceability

ระบบเดิมอยู่ที่ `C:\laragon\www\15.Drug_Master_Platform-old` ใช้เพื่ออ่านอ้างอิงเท่านั้น ตารางนี้ช่วยค้นจุดเดิมเมื่อ implement ใหม่ แต่ไม่อนุญาตให้ copy secret/data

| เรื่อง | แหล่งเดิม | ปลายทางใหม่ |
|---|---|---|
| JHCIS query + initial TMT sync | `app/SyncService.php` | `modules/jhcis`, `modules/standards` |
| TMT token/API transport | `app/TmtApiClient.php` | `modules/standards/adapters` |
| DrugCat import/reconcile | `app/DrugCatalogImportService.php` | `modules/drug-catalog` |
| mapping/search/A-E/ISED | `app/DrugRepository.php` | `modules/mappings` |
| PRODUCTCAT | `app/ProductCategory.php` | mapping domain policy |
| locked XLS export | `app/ExportService.php` | `modules/exports` |
| DB entities | `database/schema.sql` | `db/schema` + migrations |
| Agent server sync | `app/AgentSyncService.php`, `agent-api.php`, `agent-enroll.php` | `app/api/v1/agent` |
| Windows tray | `agentAutoData/src/tray_agent.py` | `agent/windows` |
| API manual | `tmtapi_manual.pdf` | `docs/TMT_API.md` |
| Excel template | `05957_drugcat_pass.xls` | approved blank `references/templates` |

## Legacy behavior deliberately removed

- PHP pages/endpoints และ direct session globals
- mapping approval/approved fields
- direct cloud-to-LAN JHCIS mode
- predictable `admin/admin` production seed
- storing secrets in distributable `.env`/build folders
- installer binaries in source repository
- trusting old JHCIS TMT/TTMT code
- drugtype 05

## Known legacy issues not to repeat

- source Agent version and installer version diverged
- running tray did not reload configuration written by protocol-launch process
- upgrade left old process/shortcut/install artifacts
- direct page submits caused refresh/jump-to-top
- FULLTEXT/search behavior depended on database capabilities
- old mapping schema retained approval fields after workflow removed

