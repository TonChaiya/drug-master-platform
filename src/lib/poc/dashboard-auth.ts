import { constantTimeTextEqual } from "@/lib/poc/hmac";

export function isDashboardAuthorized(request: Request): boolean {
  const configured = process.env.POC_DASHBOARD_TOKEN?.trim();
  if (!configured) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  return constantTimeTextEqual(authorization.slice(prefix.length), configured);
}
