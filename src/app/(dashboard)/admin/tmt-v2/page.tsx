import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/modules/auth/session";
import { tmtV2BrowserEnabled } from "@/modules/tmt/feature";
import { readTmtV2Readiness } from "@/modules/tmt/readiness";
import { TmtBrowser } from "./tmt-browser";

export const dynamic = "force-dynamic";

export default async function TmtV2BrowserPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }
  if (user.role !== "admin") redirect("/dashboard");

  const enabled = tmtV2BrowserEnabled();
  const readiness = enabled ? await readTmtV2Readiness() : null;
  const ready = readiness?.ready === true;
  return (
    <div className="space-y-3.5">
      <PageHeader eyebrow="ผู้ดูแลระบบ · TMT v2" title="TMT Browser" description="ค้นหา concept ทุกระดับ ดู MasterTMT enrichment และสำรวจความสัมพันธ์โดยไม่แก้ข้อมูล" />
      {ready && readiness.assurance === "validated_unverified" ? (
        <Alert tone="warning" title="ข้อมูล TMT ผ่านการตรวจสอบแบบ degraded">
          ชุดข้อมูล full-unverified ผ่าน checkpoint, invariants, GPU 764169 และ TTMT validation แล้ว แต่ยังไม่มีเวอร์ชันยืนยันจาก upstream
        </Alert>
      ) : null}
      {ready ? <TmtBrowser /> : (
        <Alert tone="info" title="TMT Browser v2 ยังไม่เปิดใช้งาน">
          {enabled
            ? "เปิด flag แล้ว แต่ latest TMT sync ยังไม่มี verified หรือ validated-unverified readiness ที่ใช้ได้"
            : "ต้อง apply migrations 0014/0015, ซิงก์ข้อมูล v2 สำเร็จ, ตรวจ invariants และตั้ง TMT_V2_BROWSER_ENABLED=1 อย่างชัดเจนก่อนใช้งาน"}
        </Alert>
      )}
    </div>
  );
}
