import { apiJson } from "@/lib/api-response";
import { readMaintenanceState } from "./service";

export async function maintenanceMutationResponse(): Promise<Response | null> {
  const state = await readMaintenanceState();
  if (state.available && !state.enabled) return null;
  return apiJson({ ok: false, errorCode: "MAINTENANCE_MODE", message: "ระบบอยู่ระหว่างบำรุงรักษา กรุณาลองใหม่ภายหลัง" }, 503);
}
