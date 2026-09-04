import { redirect } from "next/navigation";
import { ReadinessRow } from "@/components/readiness-row";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/card";
import { NoFacilityNotice, PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/states";
import { EmptyState } from "@/components/ui/states";
import {
  IconCheckCircle,
  IconChevronRight,
  IconDatabase,
  IconExport,
  IconMappings,
  IconPill,
} from "@/components/ui/icons";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { facilityOverview, formatBangkok } from "@/modules/facilities/queries";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const facility = await resolveEffectiveFacility(user);
  if (!facility) return <NoFacilityNotice title="ภาพรวมระบบ" isAdmin={user.role === "admin"} />;

  const overview = await facilityOverview(facility.id);
  const mappedPercent = overview.sourceTotal === 0 ? 0 : Math.round((overview.mappedTotal / overview.sourceTotal) * 100);
  const blocked = overview.readiness.filter((item) => !item.ready);
  const hasData = overview.sourceTotal > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="สถานบริการที่กำลังปฏิบัติงาน"
        title={`${facility.code} · ${facility.name}`}
        description={`ดึงข้อมูลจาก JHCIS ล่าสุด ${formatBangkok(overview.lastSyncAt)}`}
        actions={
          <>
            <ButtonLink href="/mappings" icon={<IconMappings size={15} />}>
              จับคู่รายการยา
            </ButtonLink>
            <ButtonLink href="/exports" variant="primary" icon={<IconExport size={15} />}>
              ส่งออก DrugCat
            </ButtonLink>
          </>
        }
      />

      {/* What is missing comes before what is counted: a number computed from an
          incomplete source misleads more than an empty screen would. */}
      <ReadinessRow items={overview.readiness} />

      {hasData ? (
        <>
          <section aria-label="ตัวเลขสรุป" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="รายการยาจาก JHCIS"
              value={overview.sourceTotal.toLocaleString("th-TH")}
              hint={`ชนิด 01: ${overview.type01.toLocaleString("th-TH")} · ชนิด 10: ${overview.type10.toLocaleString("th-TH")}`}
              icon={<IconDatabase size={16} />}
            />
            <StatTile
              tone="success"
              label="จับคู่มาตรฐานแล้ว"
              value={overview.mappedTotal.toLocaleString("th-TH")}
              hint={`${mappedPercent}% ของรายการทั้งหมด`}
              icon={<IconCheckCircle size={16} />}
            />
            <StatTile
              tone={overview.pendingTotal > 0 ? "warning" : "neutral"}
              label="คงค้าง"
              value={overview.pendingTotal.toLocaleString("th-TH")}
              hint={overview.pendingTotal > 0 ? "รอจับคู่กับ TMT/TTMT" : "จับคู่ครบทุกรายการแล้ว"}
              icon={<IconMappings size={16} />}
            />
            <StatTile
              tone="info"
              label="พร้อมส่งออก"
              value={overview.mappedTotal.toLocaleString("th-TH")}
              hint="บันทึกแล้วส่งออกได้ทันที"
              icon={<IconExport size={16} />}
            />
          </section>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                title="ความคืบหน้าการจับคู่"
                description="สัดส่วนรายการยาที่ใช้งานอยู่ใน JHCIS ซึ่งจับคู่กับรหัสมาตรฐานแล้ว"
                actions={
                  <ButtonLink href="/mappings" size="sm" iconAfter={<IconChevronRight size={13} />}>
                    เปิดหน้าจับคู่
                  </ButtonLink>
                }
              />
              <CardBody>
                <ProgressBar
                  value={overview.mappedTotal}
                  max={overview.sourceTotal}
                  tone={mappedPercent === 100 ? "success" : mappedPercent >= 50 ? "info" : "warning"}
                  label={`${overview.mappedTotal.toLocaleString("th-TH")} จาก ${overview.sourceTotal.toLocaleString("th-TH")} รายการ`}
                />
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3.5 sm:grid-cols-4">
                  {[
                    { label: "ชนิด 01 (TMT)", value: overview.type01 },
                    { label: "ชนิด 10 (TTMT)", value: overview.type10 },
                    { label: "จับคู่แล้ว", value: overview.mappedTotal },
                    { label: "คงค้าง", value: overview.pendingTotal },
                  ].map((item) => (
                    <div key={item.label}>
                      <dt className="type-caption">{item.label}</dt>
                      <dd className="mt-0.5 font-display text-base font-bold tabular-nums text-slate-900">
                        {item.value.toLocaleString("th-TH")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="สิ่งที่ต้องทำต่อ" description="ประเมินจากข้อมูลจริงของสถานบริการนี้" />
              <CardBody>
                {blocked.length === 0 && overview.pendingTotal === 0 ? (
                  <EmptyState
                    compact
                    icon={<IconCheckCircle size={18} />}
                    title="ไม่มีงานค้าง"
                    description="แหล่งข้อมูลครบและจับคู่ครบทุกรายการแล้ว ส่งออกไฟล์ DrugCat ได้ทันที"
                    action={
                      <ButtonLink href="/exports" size="sm" variant="primary" icon={<IconExport size={13} />}>
                        ส่งออก DrugCat
                      </ButtonLink>
                    }
                  />
                ) : (
                  <ol className="space-y-2.5">
                    {blocked.map((item, index) => (
                      <li key={item.key} className="flex items-start gap-2.5">
                        <span
                          aria-hidden
                          className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-danger-soft text-xxs font-bold text-danger"
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xxs font-semibold text-slate-700">{item.label}</p>
                          <p className="type-help mt-0.5">{item.detail}</p>
                        </div>
                        <ButtonLink href={item.href} size="sm" variant="outline" className="shrink-0">
                          {item.actionLabel}
                        </ButtonLink>
                      </li>
                    ))}
                    {overview.pendingTotal > 0 ? (
                      <li className="flex items-start gap-2.5">
                        <span
                          aria-hidden
                          className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-warning-soft text-xxs font-bold text-warning"
                        >
                          {blocked.length + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xxs font-semibold text-slate-700">จับคู่รายการที่เหลือ</p>
                          <p className="type-help mt-0.5">
                            เหลือ {overview.pendingTotal.toLocaleString("th-TH")} รายการที่ยังไม่มีรหัสมาตรฐาน
                          </p>
                        </div>
                        <ButtonLink href="/mappings" size="sm" variant="outline" className="shrink-0">
                          จับคู่
                        </ButtonLink>
                      </li>
                    ) : null}
                  </ol>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              icon={<IconPill size={22} />}
              title="ยังไม่มีรายการยาของสถานบริการนี้"
              description="ตัวเลขสรุปจะปรากฏหลังจาก Agent ดึงรายการยาที่เปิดใช้งานจาก JHCIS เข้ามาครั้งแรก"
              action={
                <ButtonLink href="/jhcis" variant="primary" icon={<IconDatabase size={15} />}>
                  ตั้งค่าการเชื่อมต่อ JHCIS
                </ButtonLink>
              }
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
