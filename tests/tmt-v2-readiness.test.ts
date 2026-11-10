import assert from "node:assert/strict";
import { test } from "vitest";
import { evaluateTmtV2Readiness } from "@/modules/tmt/readiness";

test("only the latest succeeded versioned run is TMT v2 ready", () => {
  assert.equal(evaluateTmtV2Readiness(null).ready, false);
  assert.equal(evaluateTmtV2Readiness({ mode: "full", status: "succeeded", tmtVersion: "20261102" }).ready, true);
  assert.equal(evaluateTmtV2Readiness({ mode: "incremental", status: "succeeded", tmtVersion: "20261102" }).ready, true);
});

test("unverified, failed, stale, and running runs fail closed", () => {
  for (const run of [
    { mode: "full_unverified", status: "unverified", tmtVersion: "unverified:0123456789abcdef0123" },
    { mode: "full_unverified", status: "succeeded", tmtVersion: "unverified:0123456789abcdef0123" },
    { mode: "full", status: "failed", tmtVersion: "20261102" },
    { mode: "full", status: "stale", tmtVersion: "20261102" },
    { mode: "full", status: "running", tmtVersion: "20261102" },
  ]) {
    assert.equal(evaluateTmtV2Readiness(run).ready, false, JSON.stringify(run));
  }
});
