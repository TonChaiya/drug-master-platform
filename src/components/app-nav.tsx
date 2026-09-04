"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { IconClose, IconMenu } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";

export interface NavItem {
  href: Route;
  label: string;
  icon: ReactNode;
}

export interface NavSection {
  /** Omitted for the first group, which needs no heading above it. */
  title?: string;
  items: NavItem[];
}

/**
 * The application shell: a fixed left rail, a sticky topbar carrying facility
 * context and account actions, and the page in the remaining space. Below `md`
 * the rail becomes a drawer.
 *
 * Grouping the rail into sections is what tells a user where they are in the
 * process — the four steps of getting data out of JHCIS and into a DrugCat file
 * are one group, administration is another. A flat list of seven links leaves
 * them to infer the order.
 *
 * State lives here so the layout that renders it can stay a server component
 * and pass its topbar through as children.
 */
export function AppShell({
  sections,
  topbar,
  children,
}: {
  sections: NavSection[];
  topbar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // A drawer covering the page must not leave the page scrolling underneath it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh md:pl-56">
      {open ? (
        <button
          type="button"
          aria-label="ปิดเมนู"
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={close}
        />
      ) : null}

      <aside
        id="app-navigation"
        aria-label="เมนูหลัก"
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-border bg-surface transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3.5">
          <Link href="/dashboard" onClick={close} className="flex min-w-0 items-center gap-2.5 rounded-md">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-600 font-display text-xxs font-extrabold text-white"
            >
              TM
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-sm font-bold leading-tight tracking-tight text-slate-900">
                Drug Master
              </span>
              <span className="block truncate text-xxs leading-tight text-slate-500">TMT / TTMT</span>
            </span>
          </Link>
          <IconButton size="sm" label="ปิดเมนู" icon={<IconClose size={15} />} className="md:hidden" onClick={close} />
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-4">
          {sections.map((section, index) => (
            <div key={section.title ?? `section-${index}`}>
              {section.title ? <p className="eyebrow mb-1.5 px-2.5">{section.title}</p> : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        // Closes the drawer as the navigation starts, rather
                        // than reacting to the path having changed.
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={active ? "nav-pill-active" : "nav-pill"}
                      >
                        <span aria-hidden className={active ? "text-primary-600" : "text-slate-400"}>
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-canvas/85 px-3 py-2 backdrop-blur-md sm:px-5">
        <IconButton
          size="sm"
          label="เปิดเมนู"
          icon={<IconMenu size={16} />}
          variant="secondary"
          className="md:hidden"
          aria-expanded={open}
          aria-controls="app-navigation"
          onClick={() => setOpen(true)}
        />
        {topbar}
      </header>

      <main className="mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-5 sm:py-5">{children}</main>
    </div>
  );
}
