import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";
import packageMetadata from "../package.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { AppShell } from "@/components/app-nav";
import { APP_VERSION } from "@/lib/app-version";

test("shared authenticated shell renders the authoritative package version in its footer", () => {
  assert.equal(APP_VERSION, packageMetadata.version);
  const html = renderToStaticMarkup(createElement(AppShell, {
    sections: [{ items: [] }],
    topbar: createElement("span", null, "บัญชี"),
    children: createElement("div", null, "เนื้อหา"),
  }));

  assert.match(html, /<footer[^>]*>/);
  assert.match(html, /Drug Master Platform · v0\.3\.1/);
  assert.ok(html.indexOf("เนื้อหา") < html.indexOf("Drug Master Platform · v0.3.1"));
});
