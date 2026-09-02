"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export interface FacilityChoice {
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  mappedTotal: number;
}

/**
 * Deleting one facility's mapping results. Destructive and admin-only, so the
 * facility is chosen explicitly and its 5-digit code has to be typed back —
 * the same confirmation the API enforces, surfaced rather than hidden.
 */
export function FacilityDataPanel({ facilities }: { facilities: FacilityChoice[] }) {
  const router = useRouter();
  const [facilityId, setFacilityId] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = facilities.find((row) => row.facilityId === facilityId) ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/mappings-clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId, confirmFacilityCode: confirmCode }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; deleted?: number };
      if (!response.ok || !result.ok) {
        setMessage({ ok: false, text: result.message ?? "ลบข้อมูลไม่สำเร็จ" });
        return;
      }
      setMessage({ ok: true, text: `ลบผลจับคู่ของ ${selected.facilityCode} แล้ว ${(result.deleted ?? 0).toLocaleString("th-TH")} รายการ` });
      setConfirmCode("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (facilities.length === 0) return <p className="text-xxs text-slate-500">ยังไม่มีสถานบริการที่เปิดใช้งาน</p>;

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <p className="text-xxs text-slate-500">
        ลบเฉพาะ <strong>ผลการจับคู่</strong> ของสถานบริการที่เลือก รายการยาที่ Agent ดึงมาและคลังมาตรฐานไม่ถูกแตะต้อง
        และการลบของสถานบริการหนึ่งไม่กระทบสถานบริการอื่น
      </p>

      <div className="grid gap-2.5 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="clear-facility">สถานบริการ</label>
          <select
            id="clear-facility"
            className="field"
            value={facilityId}
            onChange={(event) => {
              setFacilityId(event.target.value);
              setConfirmCode("");
              setMessage(null);
            }}
          >
            <option value="">— เลือกสถานบริการ —</option>
            {facilities.map((row) => (
              <option key={row.facilityId} value={row.facilityId}>
                {row.facilityCode} · {row.facilityName} ({row.mappedTotal.toLocaleString("th-TH")} รายการ)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="clear-confirm">พิมพ์รหัส 5 หลักเพื่อยืนยัน</label>
          <input
            id="clear-confirm"
            className="field font-mono"
            value={confirmCode}
            onChange={(event) => setConfirmCode(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            disabled={!selected}
            autoComplete="off"
          />
        </div>

        <button className="btn-danger btn-sm mb-0.5" disabled={busy || !selected || confirmCode !== selected?.facilityCode}>
          {busy ? "กำลังลบ…" : "ลบผลจับคู่"}
        </button>
      </div>

      {message ? (
        <p className={`rounded-md px-2.5 py-2 text-xxs ${message.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`} role="status">
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
