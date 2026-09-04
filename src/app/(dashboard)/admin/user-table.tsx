"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, IconButton } from "@/components/ui/button";
import { Alert, Badge, StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FilterBar, SearchInput, SelectInput, TextInput } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { Table, TableMessage, TableScroll } from "@/components/ui/table";
import { IconClose, IconEdit, IconSearch, IconTrash } from "@/components/ui/icons";

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

/** Kept in step with usernameSchema and newPasswordSchema on the server. */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{4,80}$/;
const PASSWORD_MIN = 6;

type StatusFilter = "all" | "pending" | "active" | "disabled";

export function UserTable({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const [confirming, setConfirming] = useState<AdminUserRow | null>(null);
  const [typed, setTyped] = useState("");

  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  const pendingCount = useMemo(() => users.filter((user) => user.status === "pending").length, [users]);

  /**
   * Filtered here rather than on the server: the whole list is already loaded
   * and is a few hundred rows at most, so a round trip per keystroke would buy
   * nothing.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-US");
    return users.filter((user) => {
      if (status !== "all" && user.status !== status) return false;
      if (needle.length === 0) return true;
      return [user.username, user.fullName, user.positionName, user.facilityCode, user.facilityName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("en-US").includes(needle));
    });
  }, [users, query, status]);

  const filtered = query.trim().length > 0 || status !== "all";

  async function changeStatus(userId: string, next: "active" | "disabled") {
    setBusy(userId);
    try {
      const response = await fetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, status: next }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "เปลี่ยนสถานะไม่สำเร็จ");
        return;
      }
      push("ok", next === "active" ? "เปิดใช้งานบัญชีแล้ว" : "ปิดใช้งานบัญชีแล้ว");
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

  function openEdit(user: AdminUserRow) {
    setEditing(user);
    setUsername(user.username);
    // Both password boxes start empty: leaving them that way changes only the
    // username, which is the common case and must not require retyping a
    // password the admin does not know.
    setPassword("");
    setRepeat("");
  }

  function closeEdit() {
    setEditing(null);
    setUsername("");
    setPassword("");
    setRepeat("");
  }

  function closeConfirm() {
    setConfirming(null);
    setTyped("");
  }

  const usernameChanged = editing !== null && username.trim() !== editing.username;
  const usernameValid = USERNAME_PATTERN.test(username.trim());
  const passwordValid = password.length === 0 || password.length >= PASSWORD_MIN;
  const repeatValid = password.length === 0 || repeat === password;
  const savable =
    editing !== null && usernameValid && passwordValid && repeatValid && (usernameChanged || password.length > 0);
  const editingSelf = editing?.id === currentUserId;

  async function saveCredentials() {
    if (editing === null) return;
    setBusy(editing.id);
    try {
      const response = await fetch("/api/v1/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editing.id,
          ...(usernameChanged ? { username: username.trim() } : {}),
          ...(password.length > 0 ? { password } : {}),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        usernameChanged?: boolean;
        passwordChanged?: boolean;
        sessionsRevoked?: number;
      };
      if (!response.ok || !result.ok) {
        push("error", result.message ?? "แก้ไขบัญชีไม่สำเร็จ");
        return;
      }
      const parts = [
        result.usernameChanged ? `เปลี่ยนไอดีเป็น ${username.trim()}` : null,
        result.passwordChanged ? "ตั้งรหัสผ่านใหม่แล้ว" : null,
        result.sessionsRevoked ? `ออกจากระบบอุปกรณ์อื่น ${result.sessionsRevoked} เครื่อง` : null,
      ].filter((part): part is string => part !== null);
      push("ok", parts.join(" · "));
      closeEdit();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="px-3.5 pb-3.5 sm:px-4">
        <FilterBar
          actions={
            <span className="type-caption tabular-nums" role="status" aria-live="polite">
              {filtered
                ? `แสดง ${visible.length.toLocaleString("th-TH")} จาก ${users.length.toLocaleString("th-TH")} บัญชี`
                : `ทั้งหมด ${users.length.toLocaleString("th-TH")} บัญชี`}
              {pendingCount > 0 ? ` · รออนุมัติ ${pendingCount.toLocaleString("th-TH")}` : ""}
            </span>
          }
        >
          <Field label="ค้นหาบัญชี" htmlFor="user-search" className="min-w-56 flex-1">
            <SearchInput
              id="user-search"
              placeholder="ชื่อ ไอดี ตำแหน่ง หรือสถานบริการ"
              value={query}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <Field label="สถานะ" htmlFor="user-status-filter">
            <SelectInput
              id="user-status-filter"
              className="w-36"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="all">ทั้งหมด</option>
              <option value="pending">รอดำเนินการ</option>
              <option value="active">ใช้งานอยู่</option>
              <option value="disabled">ปิดใช้งาน</option>
            </SelectInput>
          </Field>
          {filtered ? (
            <Button
              size="sm"
              className="mb-1"
              icon={<IconClose size={13} />}
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              ล้างตัวกรอง
            </Button>
          ) : null}
        </FilterBar>
      </div>

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
              <th className="cell-actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <TableMessage colSpan={7}>
                {filtered ? (
                  <EmptyState
                    compact
                    icon={<IconSearch size={18} />}
                    title="ไม่พบบัญชีที่ตรงกับเงื่อนไข"
                    description="ลองลดคำค้นลง หรือเปลี่ยนสถานะเป็น “ทั้งหมด”"
                    action={
                      <Button
                        size="sm"
                        icon={<IconClose size={13} />}
                        onClick={() => {
                          setQuery("");
                          setStatus("all");
                        }}
                      >
                        ล้างตัวกรอง
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    compact
                    title="ยังไม่มีบัญชีผู้ใช้"
                    description="บัญชีที่สมัครผ่านหน้าสมัครสมาชิกจะปรากฏที่นี่เพื่อรออนุมัติ"
                  />
                )}
              </TableMessage>
            ) : (
              visible.map((user) => {
                const isSelf = user.id === currentUserId;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{user.fullName}</span>
                        {isSelf ? <Badge tone="info">บัญชีคุณ</Badge> : null}
                      </div>
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

                    {/* One line, always. Labels are short because the dialog
                        that opens says what it does; three long buttons wrapped
                        onto three lines and left every row a different height. */}
                    <td className="cell-actions">
                      <div className="inline-flex items-center gap-1.5">
                        {/* On every row, this one included: an admin who cannot
                            change their own password would have to ask someone
                            else, and there may be nobody to ask. */}
                        <Button size="sm" icon={<IconEdit size={13} />} disabled={busy !== null} onClick={() => openEdit(user)}>
                          แก้ไข
                        </Button>

                        {/* Enabling and deleting stay barred on your own row:
                            both can lock you out, and neither is reversible
                            from this screen. */}
                        {isSelf ? null : user.status === "active" ? (
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

                        {isSelf ? null : (
                          <IconButton
                            size="sm"
                            variant="danger"
                            label={`ลบบัญชี ${user.username}`}
                            icon={<IconTrash size={13} />}
                            disabled={busy !== null}
                            onClick={() => {
                              setConfirming(user);
                              setTyped("");
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </TableScroll>

      <Dialog
        open={editing !== null}
        onClose={closeEdit}
        busy={busy !== null}
        title="แก้ไขไอดีและรหัสผ่าน"
        description={editing ? `${editing.fullName} · ${editing.positionName}` : undefined}
        footer={
          <>
            <Button onClick={closeEdit} disabled={busy !== null}>
              ยกเลิก
            </Button>
            <Button variant="primary" loading={busy !== null} disabled={!savable} onClick={() => void saveCredentials()}>
              บันทึก
            </Button>
          </>
        }
      >
        <Field
          label="ไอดีเข้าสู่ระบบ"
          htmlFor="edit-username"
          help="อังกฤษ ตัวเลข จุด ขีดกลาง ขีดล่าง 4–80 ตัวอักษร"
          error={username.trim().length > 0 && !usernameValid ? "รูปแบบไอดีไม่ถูกต้อง" : null}
          required
        >
          <TextInput
            id="edit-username"
            mono
            value={username}
            invalid={username.trim().length > 0 && !usernameValid}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            maxLength={80}
          />
        </Field>

        <div className="mt-3 border-t border-border pt-3">
          <Field
            label="รหัสผ่านใหม่"
            htmlFor="edit-password"
            help={`เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน · อย่างน้อย ${PASSWORD_MIN} ตัวอักษร`}
            error={!passwordValid ? `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร` : null}
          >
            <TextInput
              id="edit-password"
              type="password"
              value={password}
              invalid={!passwordValid}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              maxLength={128}
            />
          </Field>

          {password.length > 0 ? (
            <Field
              className="mt-2.5"
              label="พิมพ์รหัสผ่านใหม่อีกครั้ง"
              htmlFor="edit-password-repeat"
              error={!repeatValid ? "รหัสผ่านสองช่องไม่ตรงกัน" : null}
              required
            >
              <TextInput
                id="edit-password-repeat"
                type="password"
                value={repeat}
                invalid={!repeatValid}
                onChange={(event) => setRepeat(event.target.value)}
                autoComplete="new-password"
                maxLength={128}
              />
            </Field>
          ) : null}
        </div>

        {password.length > 0 ? (
          <Alert tone="warning" className="mt-3" title="การตั้งรหัสผ่านใหม่จะบังคับออกจากระบบ">
            {editingSelf
              ? "อุปกรณ์อื่นที่ยังค้างอยู่จะถูกออกจากระบบทั้งหมด หน้าจอที่กำลังใช้อยู่นี้จะยังอยู่ต่อ"
              : `บัญชี ${editing?.username} จะถูกออกจากระบบทุกอุปกรณ์ทันที และต้องใช้รหัสผ่านใหม่เข้าใช้งาน`}
          </Alert>
        ) : null}

        {usernameChanged ? (
          <Alert tone="info" className="mt-2.5" title="ไอดีที่ใช้เข้าสู่ระบบจะเปลี่ยนทันที">
            ต้องแจ้งเจ้าของบัญชีให้ใช้ <span className="font-mono font-semibold">{username.trim()}</span> แทน{" "}
            <span className="font-mono">{editing?.username}</span> ในการเข้าสู่ระบบครั้งถัดไป
          </Alert>
        ) : null}
      </Dialog>

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
