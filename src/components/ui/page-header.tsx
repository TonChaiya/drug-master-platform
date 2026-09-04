import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { cx } from "./cx";
import { IconChevronRight } from "./icons";

export interface Crumb {
  label: string;
  href?: Route;
}

/**
 * The first thing on every page, in the same shape every time.
 *
 * Title, then one line saying what the page is for, then the page's own primary
 * action on the right. The eyebrow above the title carries the facility, which
 * is the piece of context that decides what every number below it means — on a
 * system where an admin can switch facilities, that has to be visible without
 * looking for it.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  breadcrumbs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5", className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="เส้นทาง" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1 text-xxs text-slate-500">
              {breadcrumbs.map((crumb, index) => (
                <li key={crumb.label} className="flex items-center gap-1">
                  {index > 0 ? <IconChevronRight size={11} className="text-slate-300" /> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="rounded hover:text-slate-700 hover:underline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-slate-700">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="type-page-title">{title}</h1>
        {description ? <p className="type-help mt-1 max-w-3xl">{description}</p> : null}
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * The heading for a block that does not warrant a card of its own — a section
 * inside a card, or a group of controls under one label.
 */
export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5", className)}>
      <div className="min-w-0">
        <h3 className="type-card-title">{title}</h3>
        {description ? <p className="type-help mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * The page body when the admin has not chosen a facility, or the account is not
 * attached to one. Frequent enough to be worth having in one place.
 */
export function NoFacilityNotice({ title, isAdmin }: { title: string; isAdmin: boolean }) {
  return (
    <div className="space-y-3.5">
      <PageHeader title={title} />
      <div className="card card-pad">
        <p className="type-secondary">
          {isAdmin
            ? "เลือกสถานบริการจากแถบด้านบนก่อน จึงจะเห็นข้อมูลของสถานบริการนั้น"
            : "บัญชีนี้ยังไม่ถูกผูกกับสถานบริการ กรุณาติดต่อผู้ดูแลระบบ"}
        </p>
      </div>
    </div>
  );
}
