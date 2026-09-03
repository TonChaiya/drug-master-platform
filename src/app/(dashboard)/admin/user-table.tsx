"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";

export interface AdminUserRow {
  id: string;
  username: string;
  fullName: string;
  positionName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  facilityCode: string | null;
  facilityName: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  active: "badge-ok",
  pending: "badge-warn",
  disabled: "badge-muted",
};

export function UserTable({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  async function changeStatus(userId: string, status: "active" | "disabled") {
    setBusy(userId);
    try {
      const response = await fetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, status }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "เปลี่ยนสถานะไม่สำเร็จ");
        return;
      }
      push("ok", status === "active" ? "เปิดใช้งานบัญชีแล้ว" : "ปิดใช้งานบัญชีแล้ว");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  /**
   * Deleting is permanent and cannot be undone from this screen, so it asks for
   * the username to be typed back — the same shape of confirmation the
   * facility data panel uses for its own destructive action.
   */
  async function remove(user: AdminUserRow) {
    setBusy(user.id);
    try {
      const response = await fetch("/api/v1/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "ลบบัญชีไม่สำเร็จ");
        return;
      }
      push("ok", `ลบบัญชี ${user.username} แล้ว`);
      setConfirming(null);
      setTyped("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (users.length === 0) return <p className="text-xxs text-slate-500">ยังไม่มีบัญชีผู้ใช้</p>;

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>ผู้ใช้</th>
            <th>ตำแหน่ง</th>
            <th>สถานบริการ</th>
            <th>บทบาท</th>
            <th>เข้าใช้ล่าสุด</th>
            <th>สถานะ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <div className="font-medium">{user.fullName}</div>
                <div className="font-mono text-xxs text-slate-400">{user.username}</div>
              </td>
              <td>{user.positionName}</td>
              <td>{user.facilityCode ? `${user.facilityCode} · ${user.facilityName}` : <span className="text-slate-400">ส่วนกลาง</span>}</td>
              <td>
                <span className="badge-muted">{user.role === "admin" ? "ผู้ดูแลระบบ" : "ผู้ใช้"}</span>
              </td>
              <td>{user.lastLoginAt ?? "—"}</td>
              <td>
                <span className={STATUS_BADGE[user.status] ?? "badge-muted"}>{user.status}</span>
              </td>
              <td>
                {user.id === currentUserId ? (
                  <span className="text-xxs text-slate-400">บัญชีคุณเอง</span>
                ) : confirming === user.id ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      className="field w-32 font-mono"
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      placeholder={user.username}
                      aria-label={`พิมพ์ ${user.username} เพื่อยืนยันการลบ`}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={busy !== null || typed !== user.username}
                      onClick={() => void remove(user)}
                    >
                      {busy === user.id ? "กำลังลบ…" : "ลบถาวร"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setConfirming(null);
                        setTyped("");
                      }}
                    >
                      ยกเลิก
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {user.status === "active" ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => void changeStatus(user.id, "disabled")}>
                        ปิดใช้งาน
                      </button>
                    ) : (
                      <button type="button" className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void changeStatus(user.id, "active")}>
                        เปิดใช้งาน
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={busy !== null}
                      onClick={() => {
                        setConfirming(user.id);
                        setTyped("");
                      }}
                    >
                      ลบ
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
