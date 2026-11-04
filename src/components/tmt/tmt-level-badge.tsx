import { tmtLevelPresentation } from "@/modules/tmt/presentation";
import { cx } from "@/components/ui/cx";

export function TmtLevelBadge({ level }: { level: string }) {
  const presentation = tmtLevelPresentation(level);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cx("size-2 rounded-full", presentation.markerClass)} />
      <span className={presentation.badgeClass}>{presentation.label}</span>
    </span>
  );
}
