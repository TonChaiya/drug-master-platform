"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconSpinner } from "@/components/ui/icons";

export interface FacilityOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Admin-only. Selecting a facility is an explicit, audited context switch — it
 * never changes who the session belongs to.
 *
 * It sits in the topbar rather than on a settings page because it decides what
 * every figure on every screen below it refers to, and that has to stay visible
 * while working.
 */
export function FacilitySwitcher({ options, selectedId }: { options: FacilityOption[]; selectedId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function select(facilityId: string) {
    setError(null);
    const response = await fetch("/api/v1/facilities/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityId: facilityId || null }),
    });
    if (!response.ok) {
      setError("เปลี่ยนสถานบริการไม่สำเร็จ");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-none">
      <label className="sr-only" htmlFor="facility-switcher">
        สถานบริการที่กำลังปฏิบัติงาน
      </label>
      <div className="relative min-w-0 max-w-full flex-1 sm:flex-none">
        <select
          id="facility-switcher"
          className="field-select h-8 w-full min-w-0 max-w-full text-xxs font-medium sm:max-w-64"
          value={selectedId ?? ""}
          disabled={pending}
          onChange={(event) => void select(event.target.value)}
        >
          <option value="">— เลือกสถานบริการ —</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.code} · {option.name}
            </option>
          ))}
        </select>
        {pending ? (
          <IconSpinner size={14} className="absolute right-7 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
        ) : null}
      </div>
      {error ? (
        <span role="alert" className="text-xxs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
