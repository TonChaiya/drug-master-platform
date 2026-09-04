"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconLogout } from "@/components/ui/icons";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      loading={busy}
      icon={<IconLogout size={13} />}
      // The label is hidden below `sm`, so the button needs a name of its own.
      aria-label="ออกจากระบบ"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/v1/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      {/* The icon carries it on a narrow screen, where the topbar is tight. */}
      <span className="hidden sm:inline">ออกจากระบบ</span>
    </Button>
  );
}
