import { redirect } from "next/navigation";
import { AppShell, type NavItem } from "@/components/app-nav";
import { FacilitySwitcher } from "@/components/facility-switcher";
import { ToastProvider } from "@/components/toast";
import { resolveEffectiveFacility } from "@/lib/authorization/effective-facility";
import { listActiveFacilities } from "@/modules/facilities/queries";
import { currentUser } from "@/modules/auth/session";
import { LogoutButton } from "./dashboard/logout-button";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "ภาพรวม" },
  { href: "/jhcis", label: "เชื่อมต่อ JHCIS" },
  { href: "/standards", label: "มาตรฐาน TMT/TTMT" },
  { href: "/drug-catalog", label: "Drug Catalog" },
  { href: "/mappings", label: "จับคู่รายการยา" },
  { href: "/exports", label: "ส่งออก" },
];

const ADMIN_NAV: NavItem[] = [{ href: "/admin", label: "ผู้ดูแลระบบ" }];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const facility = await resolveEffectiveFacility(user);
  const facilities = user.role === "admin" ? await listActiveFacilities() : [];

  return (
    <ToastProvider>
      <AppShell
        items={user.role === "admin" ? [...NAV, ...ADMIN_NAV] : NAV}
        topbar={
          <>
            {user.role === "admin" ? (
              <FacilitySwitcher options={facilities} selectedId={facility?.id ?? null} />
            ) : (
              <span className="badge-muted">
                {facility ? `${facility.code} · ${facility.name}` : "ไม่พบสถานบริการของบัญชีนี้"}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xxs text-slate-500">
                {user.fullName} · {user.role === "admin" ? "ผู้ดูแลระบบ" : "ผู้ใช้"}
              </span>
              <LogoutButton />
            </div>
          </>
        }
      >
        {user.role === "admin" && !facility ? (
          <p className="card card-pad mb-3 border-warn/30 bg-warn-soft text-xxs text-warn">
            เลือกสถานบริการที่ต้องการปฏิบัติงานก่อน จึงจะเห็นข้อมูลของสถานบริการนั้น
          </p>
        ) : null}
        {children}
      </AppShell>
    </ToastProvider>
  );
}
