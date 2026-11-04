import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/modules/auth/session";
import { tmtV2BrowserEnabled } from "@/modules/tmt/feature";
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
  return (
    <div className="space-y-3.5">
      <PageHeader eyebrow="Experimental · internal" title="TMT Browser" description="ค้นหา concept ทุกระดับ ดู MasterTMT enrichment และสำรวจความสัมพันธ์โดยไม่แก้ข้อมูล" />
      {enabled ? <TmtBrowser /> : (
        <Alert tone="info" title="TMT Browser v2 ยังไม่เปิดใช้งาน">
          ต้อง apply migrations 0014/0015, ซิงก์ข้อมูล v2 สำเร็จ, ตรวจ invariants และตั้ง TMT_V2_BROWSER_ENABLED=1 อย่างชัดเจนก่อนใช้งาน
        </Alert>
      )}
    </div>
  );
}
