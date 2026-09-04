import type { ReactNode } from "react";
import { cx } from "./cx";
import { IconError, IconInbox, IconRefresh } from "./icons";
import { Button } from "./button";

/**
 * A screen with nothing on it yet.
 *
 * Three things, always in this order: what would be here, why it is not, and
 * the one action that would change that. An empty screen with only "ไม่พบข้อมูล"
 * on it leaves the user to guess which of five pages they were supposed to
 * visit first.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** For an empty table cell, where the surrounding card already gives context. */
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "py-6" : "px-4 py-12", className)}>
      <span
        aria-hidden
        className={cx(
          "grid place-items-center rounded-full bg-slate-100 text-slate-400",
          compact ? "size-9" : "size-12",
        )}
      >
        {icon ?? <IconInbox size={compact ? 18 : 22} />}
      </span>
      <p className={cx("mt-3 font-semibold text-slate-700", compact ? "text-xxs" : "text-sm")}>{title}</p>
      {description ? <div className="type-help mt-1 max-w-md text-balance">{description}</div> : null}
      {action ? <div className="mt-3.5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Something failed.
 *
 * Says what broke in words the user can act on, and offers the retry rather
 * than leaving them to reload the page. The technical detail is kept but
 * demoted, because it is what makes a support call answerable.
 */
export function ErrorState({
  title = "โหลดข้อมูลไม่สำเร็จ",
  description = "ระบบติดต่อฐานข้อมูลไม่ได้ในขณะนี้ ลองใหม่อีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ",
  detail,
  onRetry,
  retryLabel = "ลองอีกครั้ง",
  className,
  compact = false,
}: {
  title?: string;
  description?: ReactNode;
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "py-6" : "px-4 py-10", className)}>
      <span aria-hidden className={cx("grid place-items-center rounded-full bg-danger-soft text-danger", compact ? "size-9" : "size-12")}>
        <IconError size={compact ? 18 : 22} />
      </span>
      <p className={cx("mt-3 font-semibold text-slate-700", compact ? "text-xxs" : "text-sm")}>{title}</p>
      <div className="type-help mt-1 max-w-md text-balance">{description}</div>
      {detail ? (
        <p className="mt-1.5 max-w-md break-words font-mono text-xxs text-slate-500" title={detail}>
          {detail}
        </p>
      ) : null}
      {onRetry ? (
        <Button size="sm" className="mt-3.5" icon={<IconRefresh size={13} />} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** A single grey bar. The building block for bespoke loading layouts. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

/** Placeholder for a card whose contents are still loading. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-pad" aria-hidden>
      <Skeleton className="h-4 w-40" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className="h-3" />
        ))}
      </div>
    </div>
  );
}

/**
 * A thin progress bar with the percentage stated in text.
 *
 * The number matters as much as the bar: a long TMT sync is the one place in
 * this application where a user needs to know whether to wait or come back.
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "info",
  className,
}: {
  value: number;
  max?: number;
  label?: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
  className?: string;
}) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const fill = { info: "bg-primary-600", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];

  return (
    <div className={className}>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="type-caption">{label}</span>
          <span className="text-xxs font-semibold tabular-nums text-slate-700">{percent}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div className={cx("h-full rounded-full transition-[width] duration-500 ease-out", fill)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
