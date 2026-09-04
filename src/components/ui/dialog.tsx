"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { Button, IconButton } from "./button";
import { IconClose, IconWarning } from "./icons";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One line under the title saying what the dialog is for. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons for the footer. Confirm last, so it sits nearest the pointer. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Blocks Esc and the backdrop while a request is in flight. */
  busy?: boolean;
}

const SIZE = { sm: "w-[min(26rem,calc(100vw-1.5rem))]", md: "w-[min(34rem,calc(100vw-1.5rem))]", lg: "w-[min(48rem,calc(100vw-1.5rem))]" };

/**
 * Built on the native `<dialog>` element.
 *
 * `showModal()` supplies the things a hand-rolled overlay usually gets wrong:
 * the top layer, Esc, a real backdrop, focus moved into the dialog and
 * restored on close, and the rest of the page hidden from assistive tech. All
 * that is left for us is the appearance.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", busy = false }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx("modal-panel m-auto", SIZE[size])}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        // Esc must not abandon a request that is already running.
        if (busy) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click landing on the dialog itself rather than its contents is a
        // click on the backdrop, since the backdrop is not a separate node.
        if (!busy && event.target === ref.current) onClose();
      }}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="type-section-title">{title}</h2>
            {description ? <p className="type-help mt-1">{description}</p> : null}
          </div>
          <IconButton size="sm" label="ปิด" icon={<IconClose size={15} />} onClick={onClose} disabled={busy} />
        </header>

        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">{children}</div> : null}

        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-subtle px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `destructive` paints the confirm button solid red and adds the warning mark. */
  tone?: "default" | "destructive";
  busy?: boolean;
  /** Blocks the confirm button until whatever the caller requires is satisfied. */
  confirmDisabled?: boolean;
}

/**
 * Confirmation for an action that cannot be undone.
 *
 * Cancel is the plain button and sits first; confirm is the coloured one and
 * sits last. Nothing here is pre-focused on the destructive choice, so pressing
 * Enter out of habit cannot delete a facility's data.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  tone = "default",
  busy = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      busy={busy}
      title={
        tone === "destructive" ? (
          <span className="flex items-center gap-2">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <IconWarning size={15} />
            </span>
            {title}
          </span>
        ) : (
          title
        )
      }
      description={description}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "destructive" ? "destructive" : "primary"}
            loading={busy}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
