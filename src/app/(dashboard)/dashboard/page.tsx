import { redirect } from "next/navigation";
import { ReadinessRow } from "@/components/readiness-row";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { facilityOverview, formatBangkok } from "@/modules/facilities/queries";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="card card-pad">
      <p className="text-xxs text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xxs text-slate-500">{hint}</p> : null}
    </article>
  );
}

export default async function DashboardPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const facility = await resolveEffectiveFacility(user);
  if (!facility) {
    return (
      <section className="card card-pad">
        <h1 className="text-base font-semibold">ภาพรวมระบบ</h1>
        <p className="mt-1 text-xxs text-slate-500">
          {user.role === "admin"
            ? "เลือกสถานบริการจากแถบด้านบนเพื่อดูภาพรวม"
            : "บัญชีนี้ยังไม่ถูกผูกกับสถานบริการ กรุณาติดต่อผู้ดูแลระบบ"}
        </p>
      </section>
    );
  }

  const overview = await facilityOverview(facility.id);
  const mappedPercent = overview.sourceTotal === 0 ? 0 : Math.round((overview.mappedTotal / overview.sourceTotal) * 100);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xxs uppercase tracking-wide text-slate-500">TMT Drug Master</p>
          <h1 className="text-base font-semibold">
            {facility.code} · {facility.name}
          </h1>
        </div>
        <p className="text-xxs text-slate-500">ดึงข้อมูล JHCIS ล่าสุด {formatBangkok(overview.lastSyncAt)}</p>
      </header>

      <ReadinessRow items={overview.readiness} />

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="รายการยาจาก JHCIS"
          value={overview.sourceTotal.toLocaleString("th-TH")}
          hint={`01: ${overview.type01.toLocaleString("th-TH")} · 10: ${overview.type10.toLocaleString("th-TH")}`}
        />
        <Stat label="จับคู่แล้ว" value={overview.mappedTotal.toLocaleString("th-TH")} hint={`${mappedPercent}% ของทั้งหมด`} />
        <Stat label="คงค้าง" value={overview.pendingTotal.toLocaleString("th-TH")} hint="รอจับคู่มาตรฐาน" />
        <Stat label="พร้อมส่งออก" value={overview.mappedTotal.toLocaleString("th-TH")} hint="ไม่มีขั้นตอนอนุมัติ" />
      </section>
    </div>
  );
}
