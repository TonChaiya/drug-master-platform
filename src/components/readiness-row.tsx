import Link from "next/link";
import type { ReadinessItem } from "@/modules/facilities/queries";

/**
 * The three-source readiness row from docs/SPEC.md: green when ready,
 * red with a direct action when not.
 */
export function ReadinessRow({ items }: { items: ReadinessItem[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <li key={item.key} className="card card-pad flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${item.ready ? "bg-ok" : "bg-danger"}`}
              />
              <strong className="text-sm">{item.label}</strong>
              <span className={item.ready ? "badge-ok" : "badge-danger"}>{item.ready ? "พร้อม" : "ยังไม่พร้อม"}</span>
            </div>
            <p className="mt-1 truncate text-xxs text-slate-500" title={item.detail}>
              {item.detail}
            </p>
          </div>
          <Link href={item.href} className="btn-secondary btn-sm shrink-0">
            {item.actionLabel} →
          </Link>
        </li>
      ))}
    </ul>
  );
}
