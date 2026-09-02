/**
 * Server half of the agent signature known-answer check. The Windows agent
 * asserts the same vector in agent/windows/tests/test_signature.py; a change to
 * either canonical string breaks that side's check instead of surfacing as an
 * unexplained AGENT_SIGNATURE_INVALID once the agent is deployed.
 *
 * Run: node scripts/check-agent-signature.mjs
 */
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";

const SECRET = "test-secret-not-a-real-key";
const METHOD = "POST";
const PATH = "/api/v1/agent/sync/begin";
const TIMESTAMP = "1767225600";
const NONCE = "0123456789abcdef0123456789abcdef";
const BODY = Buffer.from('{"installationId":"11111111-1111-4111-8111-111111111111","officeId":"05957"}');
const EXPECTED = "17f4ee3274d3d30c0884b106a3b9be7570ebc7690e9176ec291679ce26312160";

// Inlined rather than imported: src/ is TypeScript with path aliases, and this
// check must stay runnable with bare node.
const canonical = ["v1", METHOD, PATH, TIMESTAMP, NONCE, createHash("sha256").update(BODY).digest("hex")].join("\n");
const actual = createHmac("sha256", SECRET).update(canonical, "utf8").digest("hex");

assert.equal(actual, EXPECTED, `signature drifted\n  expected ${EXPECTED}\n  actual   ${actual}`);
console.log("agent signature vector OK");
