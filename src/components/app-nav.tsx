"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface NavItem {
  href: Route;
  label: string;
}

/**
 * The shell the PHP system used: a fixed white left rail, a slim sticky topbar
 * for facility context and account actions, and the page in the remaining
 * space. The rail collapses to a slide-over below `md`.
 *
 * This owns the open/closed state, so the layout that renders it can stay a
 * server component and pass its topbar content through as children.
 */
export function AppShell({ items, topbar, children }: { items: NavItem[]; topbar: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="min-h-dvh md:pl-52">
      {open ? <button type="button" aria-label="ปิดเมนู" className="fixed inset-0 z-30 bg-slate-900/30 md:hidden" onClick={close} /> : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-52 border-r border-slate-200/70 bg-white px-3 py-5 transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-1" onClick={close}>
          <span className="grid size-10 place-items-center rounded-xl bg-brand-600 font-display text-xxs font-extrabold text-white shadow-sm">TM</span>
          <span className="font-display text-sm font-extrabold tracking-tight text-slate-900">Drug Master</span>
        </Link>

        <p className="eyebrow mb-2 px-3">เมนู</p>
        <ul className="space-y-0.5">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={`nav-pill ${active ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  <span className="flex-1">{item.label}</span>
                  {active ? <span aria-hidden className="size-1.5 rounded-full bg-brand-600" /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200/70 bg-paper/85 px-3 py-2 backdrop-blur-md sm:px-4">
        <button type="button" className="btn-secondary btn-sm md:hidden" onClick={() => setOpen(true)} aria-label="เปิดเมนู">
          เมนู
        </button>
        {topbar}
      </header>

      <main className="mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-5">{children}</main>
    </div>
  );
}
