"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface NavItem {
  href: Route;
  label: string;
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-semibold text-slate-900">
          <span className="grid size-7 place-items-center rounded-md bg-brand-600 text-xxs font-bold text-white">Rx</span>
          <span className="hidden sm:inline">Drug Master</span>
        </Link>

        <ul className="ml-2 hidden items-center gap-0.5 md:flex">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="btn-secondary btn-sm ml-auto md:hidden"
          aria-expanded={open}
          aria-controls="app-nav-mobile"
          onClick={() => setOpen((value) => !value)}
        >
          เมนู
        </button>
      </div>

      {open ? (
        <ul id="app-nav-mobile" className="border-t border-slate-100 px-3 pb-2 md:hidden">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
