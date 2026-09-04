"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Alert, Badge, StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { IconTrash } from "@/components/ui/icons";

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

export function UserTable({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUserRow | null>(null);
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
   * the username to be typed back — the same shape of confirmation the facility
   * data panel uses for its own destructive action.
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
      closeConfirm();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function closeConfirm() {
    setConfirming(null);
    setTyped("");
  }

  return (
    <>
      <TableScroll>
        <Table>
          <thead>
            <tr>
              <th>ผู้ใช้</th>
              <th>ตำแหน่ง</th>
              <th>สถานบริการ</th>
              <th>บทบาท</th>
              <th>เข้าใช้ล่าสุด</th>
              <th>สถานะ</th>
              <th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <TableMessage colSpan={7}>
                <EmptyState compact title="ยังไม่มีบัญชีผู้ใช้" description="บัญชีที่สมัครผ่านหน้าสมัครสมาชิกจะปรากฏที่นี่เพื่อรออนุมัติ" />
              </TableMessage>
            ) : (
              users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="font-medium">{user.fullName}</div>
                    <div className="cell-code text-xxs text-slate-500">{user.username}</div>
                  </td>
                  <td>{user.positionName}</td>
                  <td>
                    {user.facilityCode ? (
                      <>
                        <span className="cell-code">{user.facilityCode}</span>{" "}
                        <span className="text-slate-600">{user.facilityName}</span>
                      </>
                    ) : (
                      <span className="text-slate-500">ส่วนกลาง</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={user.role === "admin" ? "info" : "neutral"}>
                      {user.role === "admin" ? "ผู้ดูแลระบบ" : "ผู้ใช้"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap">{user.lastLoginAt ?? "—"}</td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                  <td>
                    {user.id === currentUserId ? (
                      <span className="type-caption whitespace-nowrap">บัญชีคุณเอง</span>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {user.status === "active" ? (
                          <Button
                            size="sm"
                            loading={busy === user.id}
                            disabled={busy !== null}
                            onClick={() => void changeStatus(user.id, "disabled")}
                          >
                            ปิดใช้งาน
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            loading={busy === user.id}
                            disabled={busy !== null}
                            onClick={() => void changeStatus(user.id, "active")}
                          >
                            เปิดใช้งาน
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<IconTrash size={13} />}
                          disabled={busy !== null}
                          onClick={() => {
                            setConfirming(user);
                            setTyped("");
                          }}
                        >
                          ลบ
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableScroll>

      <ConfirmDialog
        open={confirming !== null}
        onClose={closeConfirm}
        onConfirm={() => confirming && void remove(confirming)}
        tone="destructive"
        title="ลบบัญชีถาวร"
        description={confirming ? `${confirming.fullName} · ${confirming.positionName}` : undefined}
        confirmLabel="ลบถาวร"
        busy={busy !== null}
        confirmDisabled={typed !== confirming?.username}
      >
        <Alert tone="danger" title="การลบนี้ย้อนกลับไม่ได้">
          บัญชีและ session ที่เปิดค้างอยู่จะถูกลบทันที ข้อมูลของสถานบริการและประวัติการจับคู่ไม่ถูกแตะต้อง
        </Alert>
        <Field
          className="mt-3"
          label={
            <>
              พิมพ์ <span className="font-mono">{confirming?.username}</span> เพื่อยืนยัน
            </>
          }
          htmlFor="confirm-username"
        >
          <TextInput
            id="confirm-username"
            mono
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={confirming?.username}
            autoComplete="off"
          />
        </Field>
      </ConfirmDialog>
    </>
  );
}
