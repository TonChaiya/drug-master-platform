import type { ReactNode } from "react";
import { cx } from "./cx";

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Lifts on hover. Only for a card that is itself a link or a button. */
  interactive?: boolean;
  as?: "section" | "div" | "article" | "li";
}

/**
 * A bordered surface. Not everything needs one: a card earns its place when it
 * separates one body of information from another, and nesting a card inside a
 * card almost always means the inner one should have been a plain block with a
 * heading. `CardHeader` / `CardBody` / `CardFooter` keep the padding identical
 * everywhere, which is the whole reason this exists.
 */
export function Card({ children, className, interactive = false, as: Tag = "section" }: CardProps) {
  return <Tag className={cx(interactive ? "card-interactive" : "card", className)}>{children}</Tag>;
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or a status, right-aligned and vertically centred against the title. */
  actions?: ReactNode;
  /** Rendered before the title; use a 16px icon in a muted colour. */
  icon?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, icon, className }: CardHeaderProps) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 pt-3.5 sm:px-4 sm:pt-4", className)}>
      <div className="min-w-0">
        <h2 className="type-section-title flex items-center gap-2">
          {icon ? <span className="text-slate-400">{icon}</span> : null}
          <span className="min-w-0">{title}</span>
        </h2>
        {description ? <p className="type-help mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** `flush` removes the horizontal padding so a table can meet the card edges. */
export function CardBody({ children, className, flush = false }: { children: ReactNode; className?: string; flush?: boolean }) {
  return <div className={cx(flush ? "py-3.5 sm:py-4" : "p-3.5 sm:p-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-3 sm:px-4", className)}>
      {children}
    </div>
  );
}

/**
 * A single figure with its label. Used for the dashboard's KPI row and nowhere
 * that a sentence would do a better job.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "info";
  icon?: ReactNode;
}) {
  const tones = {
    neutral: { tile: "bg-surface border border-border", value: "text-slate-900", icon: "text-slate-400" },
    success: { tile: "bg-accent-mint-soft", value: "text-accent-mint", icon: "text-accent-mint/70" },
    warning: { tile: "bg-accent-amber-soft", value: "text-accent-amber", icon: "text-accent-amber/70" },
    info: { tile: "bg-accent-sky-soft", value: "text-accent-sky", icon: "text-accent-sky/70" },
  } as const;
  const style = tones[tone];

  return (
    <article className={cx("tile", style.tile)}>
      <div className="flex items-center justify-between gap-2">
        <p className="type-caption font-medium text-slate-600">{label}</p>
        {icon ? <span className={style.icon}>{icon}</span> : null}
      </div>
      <p className={cx("mt-1.5 font-display text-2xl font-bold tabular-nums tracking-tight", style.value)}>{value}</p>
      {hint ? <p className="type-caption mt-1">{hint}</p> : null}
    </article>
  );
}
