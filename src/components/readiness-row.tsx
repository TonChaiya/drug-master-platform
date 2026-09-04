import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconChevronRight } from "@/components/ui/icons";
import type { ReadinessItem } from "@/modules/facilities/queries";

/**
 * The three-source readiness row from docs/SPEC.md.
 *
 * Each card answers one question — is this source in place — and carries the
 * link that fixes it when the answer is no. That link is the point: telling
 * someone a prerequisite is missing without saying where to go is what makes a
 * dashboard feel like a report rather than a place to work.
 */
export function ReadinessRow({ items }: { items: ReadinessItem[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <li key={item.key} className="card-interactive p-3.5">
          <div className="flex items-center justify-between gap-2">
            <strong className="type-card-title truncate">{item.label}</strong>
            <ButtonLink
              href={item.href}
              size="sm"
              variant={item.ready ? "ghost" : "outline"}
              iconAfter={<IconChevronRight size={13} />}
              className="-mr-1.5 shrink-0"
            >
              {item.actionLabel}
            </ButtonLink>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={item.ready ? "success" : "danger"} dot>
              {item.ready ? "พร้อม" : "ยังไม่พร้อม"}
            </Badge>
            <span className="type-help min-w-0 truncate" title={item.detail}>
              {item.detail}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
