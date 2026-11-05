export type V2SavedIdentity = { source: "TMT" | "TTMT"; code: string; level: string };

export async function loadV2SavedIdentity(sourceDrugId: string): Promise<V2SavedIdentity | null> {
  const response = await fetch(`/api/v1/mappings/v2?sourceDrugId=${encodeURIComponent(sourceDrugId)}`);
  const payload = (await response.json()) as { ok?: boolean; mapping?: { standardSource: "TMT" | "TTMT" | null; standardCode: string; standardLevel: string | null } | null; message?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.message ?? "โหลดการจับคู่ล่าสุดไม่สำเร็จ");
  if (!payload.mapping?.standardSource || !payload.mapping.standardLevel) return null;
  return { source: payload.mapping.standardSource, code: payload.mapping.standardCode, level: payload.mapping.standardLevel };
}
