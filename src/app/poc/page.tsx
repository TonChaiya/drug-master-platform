import { PocDashboard } from "./poc-dashboard";
import { WEB_VERSION } from "@/lib/poc/version";

export default function PocPage() {
  return <PocDashboard version={WEB_VERSION} />;
}
