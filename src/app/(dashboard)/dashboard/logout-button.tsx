"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/v1/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      {busy ? "กำลังออก…" : "ออกจากระบบ"}
    </button>
  );
}
