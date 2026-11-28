import type { SQL } from "drizzle-orm";
import type { Pool } from "mysql2/promise";
import { dbPool } from "@/db/client";
import { readLockedTmtPointer, readTmtPointer, type TmtAssurance, type TmtPointer } from "@/modules/tmt/candidate-pointer";
import { activeStandardReleaseEnabled, independentTmtDatasetsEnabled } from "@/modules/tmt/feature";
import { readActiveStandardRelease, readLockedActiveStandardRelease } from "./active-release";

export type StandardDatasetSelection = {
  releaseId: string;
  tmtDatasetId: string;
  ttmtDatasetId?: string;
  tmtAssurance?: TmtAssurance;
};

function independentSelection(pointer: TmtPointer): StandardDatasetSelection | undefined {
  return pointer.datasetId && pointer.assurance
    ? { releaseId: `tmt:${pointer.generation}:${pointer.datasetId}`, tmtDatasetId: pointer.datasetId, tmtAssurance: pointer.assurance }
    : undefined;
}

export async function readStandardDatasetSelection(pool?: Pick<Pool, "query">, includeTmt = true): Promise<StandardDatasetSelection | undefined> {
  if (activeStandardReleaseEnabled()) {
    if (independentTmtDatasetsEnabled()) throw new Error("STANDARD_DATASET_MODES_CONFLICT");
    return readActiveStandardRelease(pool ?? dbPool());
  }
  return includeTmt && independentTmtDatasetsEnabled() ? independentSelection(await readTmtPointer(pool ?? dbPool())) : undefined;
}

export async function lockStandardDatasetSelection(executor: { execute(query: SQL): Promise<unknown> }, includeTmt = true): Promise<StandardDatasetSelection | undefined> {
  if (activeStandardReleaseEnabled()) {
    if (independentTmtDatasetsEnabled()) throw new Error("STANDARD_DATASET_MODES_CONFLICT");
    return readLockedActiveStandardRelease(executor);
  }
  return includeTmt && independentTmtDatasetsEnabled() ? independentSelection(await readLockedTmtPointer(executor)) : undefined;
}
