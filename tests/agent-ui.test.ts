import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { strict as assert } from "node:assert";
import { test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ push: vi.fn() }) }));

import { AgentActions } from "@/app/(dashboard)/jhcis/agent-actions";

test("active Agent renders every scoped admin action", () => {
  const html = renderToStaticMarkup(createElement(AgentActions, {
    installationId: "11111111-1111-4111-8111-111111111111",
    status: "active",
    targets: [{ installationId: "22222222-2222-4222-8222-222222222222", machineLabel: "CURRENT-PC" }],
  }));

  for (const label of ["Re-enroll", "ปิดใช้งาน", "ถูกแทนที่", "ลบ"]) {
    assert.match(html, new RegExp(label));
  }
});

test("disabled Agent does not offer a second disable action", () => {
  const html = renderToStaticMarkup(createElement(AgentActions, {
    installationId: "11111111-1111-4111-8111-111111111111",
    status: "disabled",
    targets: [],
  }));

  assert.doesNotMatch(html, /ปิดใช้งาน/);
  assert.match(html, /Re-enroll/);
  assert.match(html, /ลบ/);
});
