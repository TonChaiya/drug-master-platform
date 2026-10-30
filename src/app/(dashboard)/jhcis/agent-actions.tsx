"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";

export function AgentActions({
  installationId,
  status,
  targets,
}: {
  installationId: string;
  status: string;
  targets: Array<{ installationId: string; machineLabel: string }>;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(body: Record<string, string>) {
    setBusy(body.action);
    try {
      const response = await fetch("/api/v1/agent-admin/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, installationId }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; protocolUrl?: string };
      if (!response.ok || !result.ok) return push("error", result.message ?? "จัดการ Agent ไม่สำเร็จ");
      if (result.protocolUrl) {
        const link = document.createElement("a");
        link.href = result.protocolUrl;
        link.click();
      }
      push("ok", body.action === "reenroll" ? "ออกลิงก์ re-enroll แล้ว" : "อัปเดต Agent แล้ว");
      router.refresh();
    } catch {
      push("error", "ติดต่อระบบจัดการ Agent ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-48 flex-wrap gap-1.5">
      <Button size="sm" loading={busy === "reenroll"} disabled={busy !== null} onClick={() => void act({ action: "reenroll" })}>Re-enroll</Button>
      {status === "active" ? (
        <Button size="sm" loading={busy === "disable"} disabled={busy !== null} onClick={() => void act({ action: "disable" })}>ปิดใช้งาน</Button>
      ) : null}
      {targets.length ? (
        <Button
          size="sm"
          loading={busy === "supersede"}
          disabled={busy !== null}
          onClick={() => {
            const choices = targets.map((item, index) => `${index + 1}. ${item.machineLabel} (${item.installationId})`).join("\n");
            const selected = window.prompt(`เลือกหมายเลข Agent ปัจจุบัน:\n${choices}`);
            const target = selected ? targets[Number(selected) - 1] : null;
            if (target) void act({ action: "supersede", currentInstallationId: target.installationId });
          }}
        >ถูกแทนที่</Button>
      ) : null}
      <Button
        size="sm"
        variant="danger"
        loading={busy === "delete"}
        disabled={busy !== null}
        onClick={() => {
          if (window.confirm("ลบได้เฉพาะ Agent ที่ไม่เคยใช้งาน ต้องการดำเนินการต่อหรือไม่?")) void act({ action: "delete" });
        }}
      >ลบ</Button>
    </div>
  );
}
