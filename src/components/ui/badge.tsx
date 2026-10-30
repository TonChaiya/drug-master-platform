import type { ReactNode } from "react";
import { cx } from "./cx";
import { IconCheckCircle, IconError, IconInfo, IconWarning } from "./icons";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE: Record<BadgeTone, string> = {
  success: "badge-ok",
  warning: "badge-warn",
  danger: "badge-danger",
  info: "badge-info",
  neutral: "badge-muted",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** A leading dot. Cheaper to scan down a column than an icon. */
  dot?: boolean;
  className?: string;
  title?: string;
}

/**
 * The one badge in the application. Tone is meaning, not decoration:
 * success = done or ready, warning = needs attention, danger = failed or
 * destructive, info = context, neutral = a value with no judgement attached
 * (a drug type, an UPDATEFLAG). Nothing may introduce a sixth.
 */
export function Badge({ tone = "neutral", children, dot = false, className, title }: BadgeProps) {
  const dotColour = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    neutral: "bg-slate-400",
  }[tone];

  return (
    <span className={cx(TONE[tone], className)} title={title}>
      {dot ? <span aria-hidden className={cx("size-1.5 rounded-full", dotColour)} /> : null}
      {children}
    </span>
  );
}

/**
 * Maps the statuses the backend actually returns onto tones and Thai labels, so
 * a raw `succeeded` or `running` never reaches the screen and every page spells
 * the same state the same way.
 */
const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  succeeded: { tone: "success", label: "สำเร็จ" },
  complete: { tone: "success", label: "สำเร็จ" },
  completed: { tone: "success", label: "สำเร็จ" },
  active: { tone: "success", label: "ใช้งานอยู่" },
  "active-key": { tone: "success", label: "key พร้อมใช้" },
  ready: { tone: "success", label: "พร้อม" },
  synced: { tone: "success", label: "ซิงก์แล้ว" },
  matched: { tone: "success", label: "จับคู่แล้ว" },

  running: { tone: "info", label: "กำลังทำงาน" },
  receiving: { tone: "info", label: "กำลังรับข้อมูล" },
  claimed: { tone: "info", label: "Agent รับงานแล้ว" },
  aborted: { tone: "neutral", label: "ยกเลิกกลางคัน" },
  pending: { tone: "warning", label: "รอดำเนินการ" },
  queued: { tone: "warning", label: "อยู่ในคิว" },
  dispatched: { tone: "info", label: "ส่งแล้ว" },
  partial: { tone: "warning", label: "ไม่ครบ" },
  unmatched: { tone: "warning", label: "ยังไม่จับคู่" },

  failed: { tone: "danger", label: "ล้มเหลว" },
  error: { tone: "danger", label: "ผิดพลาด" },
  expired: { tone: "danger", label: "หมดอายุ" },
  revoked: { tone: "danger", label: "ถูกเพิกถอน" },
  inactive: { tone: "neutral", label: "ปิดใช้งาน" },
  disabled: { tone: "neutral", label: "ปิดใช้งาน" },
  superseded: { tone: "neutral", label: "ถูกแทนที่" },
  online: { tone: "success", label: "ออนไลน์" },
  offline: { tone: "neutral", label: "ออฟไลน์" },
  connected: { tone: "success", label: "เชื่อมต่อได้" },
  unreachable: { tone: "danger", label: "ติดต่อไม่ได้" },
  unknown: { tone: "neutral", label: "ยังไม่ทราบ" },
};

/**
 * A badge for a backend status string. An unrecognised value is shown verbatim
 * in the neutral tone rather than hidden — a status the UI has not been taught
 * about is worth seeing, not swallowing.
 */
export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="type-caption">—</span>;
  const known = STATUS[status.toLowerCase()];
  return (
    <Badge tone={known?.tone ?? "neutral"} dot className={className} title={known ? status : undefined}>
      {known?.label ?? status}
    </Badge>
  );
}

const ALERT_TONE = {
  success: { box: "border-success-border bg-success-soft text-success", Icon: IconCheckCircle },
  warning: { box: "border-warning-border bg-warning-soft text-warning", Icon: IconWarning },
  danger: { box: "border-danger-border bg-danger-soft text-danger", Icon: IconError },
  info: { box: "border-info-border bg-info-soft text-info", Icon: IconInfo },
} as const;

export interface AlertProps {
  tone: keyof typeof ALERT_TONE;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Buttons for what to do about it — a retry, a link to the page that fixes it. */
  actions?: ReactNode;
}

/**
 * An inline message attached to the thing it is about. Every page used to build
 * its own tinted paragraph; this replaces all of them so the four tones read
 * identically wherever they appear.
 */
export function Alert({ tone, title, children, className, actions }: AlertProps) {
  const { box, Icon } = ALERT_TONE[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("flex gap-2.5 rounded-lg border px-3 py-2.5", box, className)}
    >
      <Icon size={16} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1 text-xxs leading-[1.15rem]">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
