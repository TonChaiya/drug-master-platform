import { redirect } from "next/navigation";
import { ReadinessRow } from "@/components/readiness-row";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { facilityOverview, formatBangkok } from "@/modules/facilities/queries";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

/**
 * Each figure gets its own colour so the four are told apart at a glance rather
 * than by reading their labels. The tint stays pale and the figure carries the
 * colour, which keeps Thai text on it legible.
 */
const TONES = {
  ink: { tile: "bg-white border border-slate-200/70", value: "text-slate-900", chip: "bg-slate-100 text-slate-600" },
  mint: { tile: "bg-accent-mint-soft", value: "text-accent-mint", chip: "bg-white/70 text-accent-mint" },
  amber: { tile: "bg-accent-amber-soft", value: "text-accent-amber", chip: "bg-white/70 text-accent-amber" },
  brand: { tile: "bg-brand-50", value: "text-brand-700", chip: "bg-white/70 text-brand-700" },
} as const;

function Stat({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONES;
}) {
  const style = TONES[tone];
  return (
    <article className={`tile ${style.tile}`}>
      <p className="text-xxs font-medium text-slate-600">{label}</p>
      <p className={`mt-1 font-display text-3xl font-extrabold tabular-nums ${style.value}`}>{value}</p>
      {hint ? (
        <p className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-xxs font-medium ${style.chip}`}>{hint}</p>
      ) : null}
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
        <h1 className="page-title">ภาพรวมระบบ</h1>
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
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xxs uppercase tracking-wide text-slate-500">TMT Drug Master</p>
          <h1 className="page-title">
            {facility.code} · {facility.name}
          </h1>
        </div>
        <p className="text-xxs text-slate-500">ดึงข้อมูล JHCIS ล่าสุด {formatBangkok(overview.lastSyncAt)}</p>
      </header>

      <ReadinessRow items={overview.readiness} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="รายการยาจาก JHCIS"
          value={overview.sourceTotal.toLocaleString("th-TH")}
          hint={`01: ${overview.type01.toLocaleString("th-TH")} · 10: ${overview.type10.toLocaleString("th-TH")}`}
        />
        <Stat
          tone="mint"
          label="จับคู่แล้ว"
          value={overview.mappedTotal.toLocaleString("th-TH")}
          hint={`${mappedPercent}% ของทั้งหมด`}
        />
        <Stat tone="amber" label="คงค้าง" value={overview.pendingTotal.toLocaleString("th-TH")} hint="รอจับคู่มาตรฐาน" />
        <Stat
          tone="brand"
          label="พร้อมส่งออก"
          value={overview.mappedTotal.toLocaleString("th-TH")}
          hint="ไม่มีขั้นตอนอนุมัติ"
        />
      </section>
    </div>
  );
}
