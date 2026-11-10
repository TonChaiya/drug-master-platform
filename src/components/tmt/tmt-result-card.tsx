import type { ReactNode } from "react";
import type { TmtKnownStatus } from "@/modules/tmt/browser";
import { TmtLevelBadge } from "./tmt-level-badge";
import { Badge } from "@/components/ui/badge";

export interface TmtResultSummary {
  level: string;
  tmtId: string;
  name: string;
  tradeName: string | null;
  manufacturer: string | null;
  registrationNumber: string | null;
  registrationConflict: boolean;
  status: TmtKnownStatus;
  mappingEligible: boolean;
  mappingEligibilityReason: string;
}

function statusLabel(status: TmtKnownStatus): string {
  if (status === "active") return "ใช้งานอยู่";
  if (status === "cancelled") return "ยกเลิกแล้ว";
  return "ยังไม่ทราบ";
}

function OptionalValue({ label, value }: { label: string; value: string | null }) {
  return <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs"><span className="type-caption">{label}</span><span className="break-words text-ink">{value ?? ""}</span></div>;
}

export function TmtResultCard({ result, children }: { result: TmtResultSummary; children?: ReactNode }) {
  return (
    <article className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2"><TmtLevelBadge level={result.level} /><span className="cell-code">{result.tmtId}</span></div>
      <p className="mt-2 break-words text-xs font-medium text-ink">{result.name}</p>
      <div className="mt-2 space-y-1">
        <OptionalValue label="ชื่อการค้า" value={result.tradeName} />
        <OptionalValue label="ผู้ผลิต" value={result.manufacturer} />
        <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs">
          <span className="type-caption">เลขทะเบียนยา</span>
          <span className="break-words text-ink">
            {result.registrationConflict ? <Badge tone="warning">เลขทะเบียนมีหลายค่า</Badge> : (result.registrationNumber ?? "")}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={result.status === "active" ? "success" : result.status === "cancelled" ? "warning" : "neutral"}>{statusLabel(result.status)}</Badge>
        <Badge tone={result.mappingEligible ? "success" : "warning"}>{result.mappingEligibilityReason}</Badge>
      </div>
      {children ? <div className="mt-2 flex flex-wrap justify-end gap-2">{children}</div> : null}
    </article>
  );
}
