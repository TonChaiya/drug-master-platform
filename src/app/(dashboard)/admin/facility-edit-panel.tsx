"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export interface EditableFacility {
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  agentCount: number;
}

/**
 * Renaming a facility or changing its 5-digit code.
 *
 * The code is not a label: the agent reads `office.offid` from JHCIS and the
 * server refuses every request that does not match it. Changing the code here
 * therefore stops that facility's agents until JHCIS itself is changed, so the
 * panel says so before the save and repeats whatever the server reports after.
 */
export function FacilityEditPanel({ facilities }: { facilities: EditableFacility[] }) {
  const router = useRouter();
  const [facilityId, setFacilityId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = facilities.find((row) => row.facilityId === facilityId) ?? null;
  const codeChanged = selected !== null && code !== selected.facilityCode;

  function select(id: string) {
    const facility = facilities.find((row) => row.facilityId === id) ?? null;
    setFacilityId(id);
    setName(facility?.facilityName ?? "");
    setCode(facility?.facilityCode ?? "");
    setMessage(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/facilities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId, facilityName: name, facilityCode: code }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; agentWarning?: string | null };
      if (!response.ok || !result.ok) {
        setMessage({ ok: false, text: result.message ?? "บันทึกไม่สำเร็จ" });
        return;
      }
      setMessage({
        ok: true,
        text: result.agentWarning ? `บันทึกแล้ว — ${result.agentWarning}` : "บันทึกชื่อและรหัสสถานบริการแล้ว",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (facilities.length === 0) return <p className="text-xxs text-slate-500">ยังไม่มีสถานบริการที่เปิดใช้งาน</p>;

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <p className="text-xxs text-slate-500">
        ไอดีทุกบัญชีที่ผูกกับสถานบริการนี้จะเห็นชื่อใหม่ทันที ข้อมูลยา ผลจับคู่ และไฟล์ส่งออกไม่ถูกแตะต้อง
      </p>

      <div>
        <label className="label" htmlFor="edit-facility">สถานบริการ</label>
        <select id="edit-facility" className="field" value={facilityId} onChange={(event) => select(event.target.value)}>
          <option value="">— เลือกสถานบริการ —</option>
          {facilities.map((row) => (
            <option key={row.facilityId} value={row.facilityId}>
              {row.facilityCode} · {row.facilityName}
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <>
          <div className="grid gap-2.5 sm:grid-cols-[8rem_1fr]">
            <div>
              <label className="label" htmlFor="edit-code">รหัส 5 หลัก</label>
              <input
                className="field font-mono"
                id="edit-code"
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="edit-name">ชื่อสถานบริการ</label>
              <input
                className="field"
                id="edit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={255}
                required
              />
            </div>
          </div>

          {codeChanged ? (
            <p className="rounded-md bg-warn-soft px-2.5 py-2 text-xxs text-warn">
              กำลังเปลี่ยนรหัสจาก <strong className="font-mono">{selected.facilityCode}</strong> เป็น{" "}
              <strong className="font-mono">{code || "—"}</strong> — Agent อ่าน <code className="font-mono">office.offid</code> จาก JHCIS
              และจะหยุดส่งข้อมูลจนกว่าค่าใน JHCIS จะตรงกับรหัสใหม่
              {selected.agentCount > 0 ? ` ขณะนี้มี Agent ${selected.agentCount.toLocaleString("th-TH")} เครื่องลงทะเบียนอยู่` : ""}
            </p>
          ) : null}
        </>
      ) : null}

      {message ? (
        <p className={`rounded-md px-2.5 py-2 text-xxs ${message.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`} role="status">
          {message.text}
        </p>
      ) : null}

      <button className="btn-primary btn-sm" disabled={busy || !selected}>
        {busy ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
      </button>
    </form>
  );
}
