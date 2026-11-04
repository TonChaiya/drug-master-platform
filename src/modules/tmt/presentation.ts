export const TMT_LEVEL_PRESENTATION = {
  subs: { label: "SUBS", markerClass: "bg-slate-400", badgeClass: "badge-muted" },
  vtm: { label: "VTM", markerClass: "bg-slate-400", badgeClass: "badge-muted" },
  gp: { label: "GP", markerClass: "bg-danger", badgeClass: "badge-danger" },
  gpu: { label: "GPU", markerClass: "bg-success", badgeClass: "badge-ok" },
  gpp: { label: "GPP", markerClass: "bg-slate-400", badgeClass: "badge-muted" },
  tp: { label: "TP", markerClass: "bg-warning", badgeClass: "badge-warn" },
  tpu: { label: "TPU", markerClass: "bg-info", badgeClass: "badge-info" },
  tpp: { label: "TPP", markerClass: "bg-slate-400", badgeClass: "badge-muted" },
} as const;

export type KnownTmtLevel = keyof typeof TMT_LEVEL_PRESENTATION;

export function tmtLevelPresentation(level: string): { label: string; markerClass: string; badgeClass: string } {
  return TMT_LEVEL_PRESENTATION[level as KnownTmtLevel] ?? {
    label: level.toUpperCase(),
    markerClass: "bg-slate-400",
    badgeClass: "badge-muted",
  };
}
