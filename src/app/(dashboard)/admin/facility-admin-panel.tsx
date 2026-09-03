"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export interface AdminFacility {
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  sourceTotal: number;
  mappedTotal: number;
  agentCount: number;
  accountCount: number;
}

type Scope = "mappings" | "catalog" | "source" | "agents" | "all";

interface ScopeOption {
  value: Scope;
  label: string;
  detail: string;
}

/**
 * Each scope says what else goes with it, because the tables reference each
 * other: a mapping points at a source drug and at the catalog import it came
 * from, so removing the drugs necessarily removes the mappings built on them.
 * Stating that here is better than a delete that quietly takes more than the
 * label implied.
 */
const SCOPES: ScopeOption[] = [
  { value: "mappings", label: "ผลการจับคู่", detail: "ลบเฉพาะผลจับคู่ รายการยาและไฟล์ที่นำเข้ายังอยู่" },
  { value: "catalog", label: "ไฟล์ Drug Catalog ที่นำเข้า", detail: "ลบไฟล์ที่นำเข้าและผลจับคู่ที่อ้างอิงไฟล์นั้น" },
  { value: "source", label: "รายการยาจาก JHCIS", detail: "ลบรายการยาที่ Agent ดึงมา พร้อมผลจับคู่และไฟล์ที่นำเข้า" },
  { value: "agents", label: "การลงทะเบียน Agent", detail: "ถอนทะเบียนทุกเครื่อง กุญแจ คำสั่ง และประวัติการดึงข้อมูล" },
  { value: "all", label: "ทั้งหมดของสถานบริการนี้", detail: "ล้างทุกอย่างข้างต้น เหลือแค่ชื่อสถานบริการและบัญชีผู้ใช้" },
];

/**
 * One place for everything an admin does to a single facility: renaming it,
 * changing its code, and wiping its data. They shared nothing but a facility
 * picker before, and having two of those on one screen invited picking the
 * facility in one panel and acting in the other.
 */
export function FacilityAdminPanel({ facilities }: { facilities: AdminFacility[] }) {
  const router = useRouter();
  const [facilityId, setFacilityId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [scope, setScope] = useState<Scope>("mappings");
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = facilities.find((row) => row.facilityId === facilityId) ?? null;
  const codeChanged = selected !== null && code !== selected.facilityCode;
  const chosenScope = SCOPES.find((option) => option.value === scope);

  function select(id: string) {
    const facility = facilities.find((row) => row.facilityId === id) ?? null;
    setFacilityId(id);
    setName(facility?.facilityName ?? "");
    setCode(facility?.facilityCode ?? "");
    setConfirmCode("");
    setMessage(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy("save");
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
      setBusy(null);
    }
  }

  async function clear() {
    if (!selected) return;
    setBusy("clear");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/facility-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityId, confirmFacilityCode: confirmCode, scope }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        deleted?: { mappings: number; catalogRows: number; catalogImports: number; sourceDrugs: number; agents: number };
      };
      if (!response.ok || !result.ok || !result.deleted) {
        setMessage({ ok: false, text: result.message ?? "ล้างข้อมูลไม่สำเร็จ" });
        return;
      }
      const d = result.deleted;
      const parts = [
        d.mappings > 0 ? `ผลจับคู่ ${d.mappings.toLocaleString("th-TH")}` : null,
        d.catalogImports > 0 ? `ไฟล์นำเข้า ${d.catalogImports.toLocaleString("th-TH")} (${d.catalogRows.toLocaleString("th-TH")} แถว)` : null,
        d.sourceDrugs > 0 ? `รายการยา ${d.sourceDrugs.toLocaleString("th-TH")}` : null,
        d.agents > 0 ? `Agent ${d.agents.toLocaleString("th-TH")} เครื่อง` : null,
      ].filter((part): part is string => part !== null);
      setMessage({
        ok: true,
        text: parts.length > 0 ? `ล้างแล้ว: ${parts.join(" · ")}` : "ไม่มีข้อมูลในขอบเขตที่เลือกให้ลบ",
      });
      setConfirmCode("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (facilities.length === 0) return <p className="text-xxs text-slate-500">ยังไม่มีสถานบริการที่เปิดใช้งาน</p>;

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="admin-facility">เลือกสถานบริการ</label>
        <select id="admin-facility" className="field" value={facilityId} onChange={(event) => select(event.target.value)}>
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
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "ยาจาก JHCIS", value: selected.sourceTotal },
              { label: "จับคู่แล้ว", value: selected.mappedTotal },
              { label: "ไอดี", value: selected.accountCount },
              { label: "Agent", value: selected.agentCount },
            ].map((tile) => (
              <div key={tile.label} className="rounded-md bg-slate-50 px-2.5 py-2">
                <dt className="text-xxs text-slate-500">{tile.label}</dt>
                <dd className="font-display text-base font-extrabold tabular-nums">{tile.value.toLocaleString("th-TH")}</dd>
              </div>
            ))}
          </dl>

          <form onSubmit={save} className="space-y-2.5 border-t border-slate-200 pt-3">
            <h3 className="text-xxs font-bold text-slate-700">แก้ไขชื่อและรหัส</h3>
            <div className="grid gap-2.5 sm:grid-cols-[8rem_1fr]">
              <div>
                <label className="label" htmlFor="admin-code">รหัส 5 หลัก</label>
                <input
                  className="field font-mono"
                  id="admin-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.trim())}
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  maxLength={5}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="admin-name">ชื่อสถานบริการ</label>
                <input
                  className="field"
                  id="admin-name"
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

            <button className="btn-primary btn-sm" disabled={busy !== null}>
              {busy === "save" ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
            </button>
          </form>

          <div className="space-y-2.5 border-t border-slate-200 pt-3">
            <h3 className="text-xxs font-bold text-danger">ล้างข้อมูลของสถานบริการนี้</h3>
            <p className="text-xxs text-slate-500">
              ลบเฉพาะข้อมูลของ <strong>{selected.facilityCode}</strong> เท่านั้น คลังมาตรฐาน TMT/TTMT ที่ใช้ร่วมกัน
              สถานบริการอื่น และบัญชีผู้ใช้ ไม่ถูกแตะต้อง
            </p>

            <fieldset className="space-y-1">
              {SCOPES.map((option) => (
                <label key={option.value} className="flex items-start gap-2 rounded-md px-1 py-1 text-xxs hover:bg-slate-50">
                  <input
                    type="radio"
                    name="scope"
                    className="mt-0.5"
                    checked={scope === option.value}
                    onChange={() => {
                      setScope(option.value);
                      setMessage(null);
                    }}
                  />
                  <span>
                    <span className={option.value === "all" ? "font-bold text-danger" : "font-medium text-slate-700"}>{option.label}</span>
                    <span className="block text-slate-500">{option.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label" htmlFor="admin-confirm">พิมพ์รหัส {selected.facilityCode} เพื่อยืนยัน</label>
                <input
                  id="admin-confirm"
                  className="field w-32 font-mono"
                  value={confirmCode}
                  onChange={(event) => setConfirmCode(event.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  maxLength={5}
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                className="btn-danger btn-sm mb-0.5"
                disabled={busy !== null || confirmCode !== selected.facilityCode}
                onClick={() => void clear()}
              >
                {busy === "clear" ? "กำลังล้าง…" : `ล้าง: ${chosenScope?.label ?? ""}`}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {message ? (
        <p className={`rounded-md px-2.5 py-2 text-xxs ${message.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
