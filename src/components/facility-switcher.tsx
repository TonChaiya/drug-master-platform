"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface FacilityOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Admin-only. Selecting a facility is an explicit, audited context switch — it
 * never changes who the session belongs to.
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
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor="facility-switcher">
        สถานบริการที่กำลังปฏิบัติงาน
      </label>
      <select
        id="facility-switcher"
        className="field max-w-56 py-1 text-xxs"
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
      {error ? <span className="text-xxs text-danger">{error}</span> : null}
    </div>
  );
}
