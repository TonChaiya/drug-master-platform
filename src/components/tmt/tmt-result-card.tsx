import type { ReactNode } from "react";
import type { TmtKnownStatus } from "@/modules/tmt/browser";
import { TmtLevelBadge } from "./tmt-level-badge";
import { Badge } from "@/components/ui/badge";

export interface TmtResultSummary {
  level: string;
  tmtId: string;
  name: string;
  activeIngredient?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
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

export function TmtResultCard({ result, children, comparison = false, current = false }: { result: TmtResultSummary; children?: ReactNode; comparison?: boolean; current?: boolean }) {
  const decisionName = comparison && result.activeIngredient ? result.activeIngredient : result.name;
  return (
    <article className={`min-w-0 rounded-lg border p-3 ${current ? "border-primary-300 bg-primary-50/50" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2"><TmtLevelBadge level={result.level} /><span className="cell-code">{result.tmtId}</span>{current ? <Badge tone="info">รายการปัจจุบัน</Badge> : null}</div>
      <p className="mt-2 break-words text-xs font-semibold text-ink">{decisionName}{comparison && result.strength ? ` · ${result.strength}` : null}</p>
      {comparison && result.activeIngredient && result.name !== result.activeIngredient ? <p className="type-help mt-0.5 break-words">{result.name}</p> : null}
      <div className="mt-2 space-y-1">
        {comparison ? <OptionalValue label="รูปแบบยา" value={result.dosageForm ?? null} /> : null}
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
