"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { IconCheckCircle, IconClose, IconError, IconInfo, IconWarning } from "@/components/ui/icons";

export type ToastTone = "ok" | "error" | "warning" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const TONE = {
  ok: { box: "border-success-border bg-success-soft text-success", Icon: IconCheckCircle },
  error: { box: "border-danger-border bg-danger-soft text-danger", Icon: IconError },
  warning: { box: "border-warning-border bg-warning-soft text-warning", Icon: IconWarning },
  info: { box: "border-border bg-surface text-slate-700", Icon: IconInfo },
} as const;

/** An error stays long enough to be read and copied; the rest clear quickly. */
const DURATION: Record<ToastTone, number> = { ok: 4000, info: 4000, warning: 6000, error: 8000 };

/** More than this on screen at once is noise, so the oldest is dropped. */
const MAX_VISIBLE = 3;

const ToastContext = createContext<{ push: (tone: ToastTone, message: string) => void } | null>(null);

/**
 * Transient feedback for actions the user just took. Nothing here reloads the
 * page or moves the scroll position.
 *
 * A toast is the wrong place for anything the user has to act on — those belong
 * in an `Alert` next to the control that caused them, where they stay put.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, tone, message }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION[tone]),
      );
    },
    [dismiss],
  );

  // Timers outlive the component if the user navigates while one is pending.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const { box, Icon } = TONE[toast.tone];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-raised ${box}`}
            >
              <Icon size={16} className="mt-px shrink-0" />
              <p className="min-w-0 flex-1 text-xxs leading-[1.15rem]">{toast.message}</p>
              <IconButton
                size="sm"
                label="ปิดข้อความ"
                icon={<IconClose size={13} />}
                className="-my-1 -mr-1.5 shrink-0 text-current hover:bg-black/5"
                onClick={() => dismiss(toast.id)}
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
