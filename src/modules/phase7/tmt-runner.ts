export type TmtOperationalMode = "full" | "full-unverified" | "incremental" | "resume";

export interface TmtOperationalResult {
  status: string;
  runId: string;
  coreReady: boolean;
}

export interface TmtRunnerDependencies {
  full(): Promise<TmtOperationalResult>;
  fullUnverified(): Promise<TmtOperationalResult>;
  incremental(): Promise<TmtOperationalResult>;
  resume(runId: string): Promise<TmtOperationalResult>;
}

export interface TmtOperationalPlan {
  mode: TmtOperationalMode;
  dryRun: boolean;
  historyStart: "2013-01-01";
  targetTables: readonly string[];
  result?: TmtOperationalResult;
}

const TARGET_TABLES = [
  "tmt_subs", "tmt_vtm", "tmt_gp", "tmt_gpu", "tmt_gpp", "tmt_tp", "tmt_tpu", "tmt_tpp",
  "tmt_nlem", "tmt_atc", "tmt_regno", "tmt_mastertmt", "tmt_concept", "tmt_relationship",
  "tmt_version", "tmt_sync_runs", "tmt_sync_checkpoints",
] as const;

export async function runOperationalTmtSync(
  input: { mode: TmtOperationalMode; runId?: string; dryRun: boolean; credentialPresent: boolean },
  dependencies: TmtRunnerDependencies,
): Promise<TmtOperationalPlan> {
  if (!input.credentialPresent) throw new Error("TMT credential is not configured");
  if (input.mode === "resume" && !input.runId) throw new Error("Resume mode requires a run id");
  const plan: TmtOperationalPlan = { mode: input.mode, dryRun: input.dryRun, historyStart: "2013-01-01", targetTables: TARGET_TABLES };
  if (input.dryRun) return plan;
  const result = input.mode === "full"
    ? await dependencies.full()
    : input.mode === "full-unverified"
      ? await dependencies.fullUnverified()
      : input.mode === "incremental"
        ? await dependencies.incremental()
        : await dependencies.resume(input.runId!);
  return { ...plan, result };
}
