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
                ) : user.status === "active" ? (
                  <button type="button" className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => void changeStatus(user.id, "disabled")}>
                    ปิดใช้งาน
                  </button>
                ) : (
                  <button type="button" className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void changeStatus(user.id, "active")}>
                    เปิดใช้งาน
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
