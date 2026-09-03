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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xxs font-medium shadow-sm ring-1 ring-slate-200/70">
                <span aria-hidden className="size-1.5 rounded-full bg-ok" />
                {facility ? `${facility.code} · ${facility.name}` : "ไม่พบสถานบริการของบัญชีนี้"}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2.5">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-xxs font-semibold text-slate-900">{user.fullName}</div>
                <div className="text-xxs text-slate-500">{user.role === "admin" ? "ผู้ดูแลระบบ" : "ผู้ใช้"}</div>
              </div>
              {/* Initials rather than a photo: there is nowhere to upload one,
                  and a coloured disc still tells you whose session this is. */}
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 font-display text-xxs font-extrabold text-brand-700 ring-2 ring-white"
              >
                {user.fullName.trim().slice(0, 2)}
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
