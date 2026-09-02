import { noStoreJson } from "@/lib/poc/http";
import { WEB_VERSION } from "@/lib/poc/version";

export const dynamic = "force-dynamic";

export function GET() {
  return noStoreJson({
    ok: true,
    service: "tmt-drug-master-poc",
    serverTime: new Date().toISOString(),
    version: WEB_VERSION,
  });
}
