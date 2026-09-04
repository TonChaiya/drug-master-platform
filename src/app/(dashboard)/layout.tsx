import { redirect } from "next/navigation";
import { AppShell, type NavSection } from "@/components/app-nav";
import { FacilitySwitcher } from "@/components/facility-switcher";
import { ToastProvider } from "@/components/toast";
import { Alert } from "@/components/ui/badge";
import {
  IconCatalog,
  IconExport,
  IconMappings,
  IconOverview,
  IconPlug,
  IconShield,
  IconStandards,
} from "@/components/ui/icons";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { listActiveFacilities } from "@/modules/facilities/queries";
import { currentUser } from "@/modules/auth/session";
import { LogoutButton } from "./dashboard/logout-button";

/**
 * The rail is grouped to match the actual order of work: connect a source, load
 * the two references it is checked against, pair them, then export. A user who
 * has never seen the system can read the process off the menu.
 */
const SECTIONS: NavSection[] = [
  { items: [{ href: "/dashboard", label: "ภาพรวม", icon: <IconOverview size={16} /> }] },
  {
    title: "ข้อมูลตั้งต้น",
    items: [
      { href: "/jhcis", label: "เชื่อมต่อ JHCIS", icon: <IconPlug size={16} /> },
      { href: "/standards", label: "มาตรฐาน TMT/TTMT", icon: <IconStandards size={16} /> },
      { href: "/drug-catalog", label: "Drug Catalog", icon: <IconCatalog size={16} /> },
    ],
  },
  {
    title: "งานประจำวัน",
    items: [
      { href: "/mappings", label: "จับคู่รายการยา", icon: <IconMappings size={16} /> },
      { href: "/exports", label: "ส่งออก DrugCat", icon: <IconExport size={16} /> },
    ],
  },
];

const ADMIN_SECTION: NavSection = {
  title: "ผู้ดูแลระบบ",
  items: [{ href: "/admin", label: "จัดการระบบ", icon: <IconShield size={16} /> }],
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const facility = await resolveEffectiveFacility(user);
  const facilities = user.role === "admin" ? await listActiveFacilities() : [];
  const isAdmin = user.role === "admin";

  return (
    <ToastProvider>
      <AppShell
        sections={isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS}
        topbar={
          <>
            {isAdmin ? (
              <FacilitySwitcher options={facilities} selectedId={facility?.id ?? null} />
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xxs font-medium">
                <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${facility ? "bg-success" : "bg-danger"}`} />
                <span className="truncate">
                  {facility ? `${facility.code} · ${facility.name}` : "ไม่พบสถานบริการของบัญชีนี้"}
                </span>
              </span>
            )}

            <div className="ml-auto flex items-center gap-2.5">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-xxs font-semibold text-slate-900">{user.fullName}</div>
                <div className="text-xxs text-slate-500">{isAdmin ? "ผู้ดูแลระบบ" : "ผู้ใช้สถานบริการ"}</div>
              </div>
              {/* Initials rather than a photo: there is nowhere to upload one,
                  and a disc still tells you whose session this is. */}
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-100 font-display text-xxs font-bold text-primary-700"
              >
                {user.fullName.trim().slice(0, 2)}
              </span>
              <LogoutButton />
            </div>
          </>
        }
      >
        {isAdmin && !facility ? (
          <Alert tone="warning" className="mb-3.5" title="ยังไม่ได้เลือกสถานบริการ">
            เลือกสถานบริการที่ต้องการปฏิบัติงานจากแถบด้านบนก่อน จึงจะเห็นข้อมูลของสถานบริการนั้น
          </Alert>
        ) : null}
        {children}
      </AppShell>
    </ToastProvider>
  );
}
