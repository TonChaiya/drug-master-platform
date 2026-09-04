import type { ReactNode } from "react";
import { cx } from "./cx";
import { Button } from "./button";
import { IconChevronLeft, IconChevronRight } from "./icons";

/**
 * Wraps a table so it scrolls inside its own box instead of widening the page.
 *
 * Drug tables are wide by nature — a code, two names, a strength, a
 * manufacturer — and on a laptop they will not fit. Scrolling the table is
 * right; scrolling the whole document sideways is not.
 */
export function TableScroll({ children, className, maxHeight }: { children: ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div className={cx("overflow-x-auto", maxHeight && "overflow-y-auto", className)} style={maxHeight ? { maxHeight } : undefined}>
      {children}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cx("data-table", className)}>{children}</table>;
}

/** Sticks the header to the top of a scrolling table body. */
export function StickyHead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10">{children}</thead>;
}

/**
 * A message spanning the full width of a table, for "no rows" and "nothing
 * matched" — inside the table rather than replacing it, so the column headings
 * stay put and the user can see which filter to relax.
 */
export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="hover:bg-transparent">
      <td colSpan={colSpan} className="px-3 py-10 text-center">
        {children}
      </td>
    </tr>
  );
}

/**
 * Grey bars in the shape of the rows that are coming.
 *
 * Preferred over a spinner because the table does not collapse and then jump
 * back to its height when the data lands.
 */
export function TableSkeleton({ rows = 6, columns }: { rows?: number; columns: number }) {
  return (
    <tbody aria-hidden>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex}>
              <span
                className="skeleton block h-3.5"
                // Varying the widths stops the block reading as a solid grey
                // rectangle, which is what makes a skeleton legible as content.
                style={{ width: `${[70, 90, 55, 80, 65, 75, 60][(rowIndex + columnIndex) % 7]}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export interface PaginationProps {
  page: number;
  pageCount: number;
  total?: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

/**
 * Previous / next with the position stated between them.
 *
 * Numbered pages are not worth it here: the worklists are filtered down before
 * they are read, and nobody navigates to page 27 of a drug list by number.
 */
export function Pagination({ page, pageCount, total, onPageChange, disabled = false }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3.5 py-2.5 sm:px-4">
      <p className="type-caption" aria-live="polite">
        หน้า <span className="font-semibold text-slate-700 tabular-nums">{page.toLocaleString("th-TH")}</span> จาก{" "}
        <span className="tabular-nums">{pageCount.toLocaleString("th-TH")}</span>
        {typeof total === "number" ? ` · ทั้งหมด ${total.toLocaleString("th-TH")} รายการ` : ""}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          icon={<IconChevronLeft size={13} />}
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ก่อนหน้า
        </Button>
        <Button
          size="sm"
          iconAfter={<IconChevronRight size={13} />}
          disabled={disabled || page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          ถัดไป
        </Button>
      </div>
    </div>
  );
}
