export type AgentErrorCode =
  | "AGENT_AUTH_MISSING"
  | "AGENT_PROTOCOL_UNSUPPORTED"
  | "AGENT_KEY_UNKNOWN"
  | "AGENT_CREDENTIAL_REVOKED"
  | "AGENT_TIMESTAMP_INVALID"
  | "AGENT_NONCE_INVALID"
  | "AGENT_NONCE_REPLAYED"
  | "AGENT_SIGNATURE_INVALID"
  | "AGENT_INSTALLATION_INACTIVE"
  | "AGENT_FACILITY_INACTIVE"
  | "AGENT_OFFICE_MISMATCH"
  | "AGENT_SESSION_INVALID"
  | "AGENT_BATCH_INVALID"
  | "AGENT_ROW_COUNT_MISMATCH"
  | "AGENT_ENROLLMENT_INVALID"
  | "AGENT_POSSIBLE_DUPLICATE"
  | "AGENT_COMMAND_INVALID"
  | "AGENT_PAYLOAD_TOO_LARGE"
  | "AGENT_BODY_INVALID";

/** Carries a machine-readable code; the message is safe to return and never contains secrets. */
export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export const agentErrors = {
  authMissing: () => new AgentError("AGENT_AUTH_MISSING", 401, "ข้อมูลยืนยันตัวตนของ Agent ไม่ครบ"),
  protocolUnsupported: () => new AgentError("AGENT_PROTOCOL_UNSUPPORTED", 400, "protocol version ไม่รองรับ"),
  keyUnknown: () => new AgentError("AGENT_KEY_UNKNOWN", 401, "ยืนยันตัวตนไม่สำเร็จ"),
  credentialRevoked: () => new AgentError("AGENT_CREDENTIAL_REVOKED", 401, "ยืนยันตัวตนไม่สำเร็จ"),
  timestampInvalid: () => new AgentError("AGENT_TIMESTAMP_INVALID", 401, "เวลาของเครื่อง Agent อยู่นอกช่วงที่อนุญาต"),
  nonceInvalid: () => new AgentError("AGENT_NONCE_INVALID", 401, "nonce ไม่ถูกต้อง"),
  nonceReplayed: () => new AgentError("AGENT_NONCE_REPLAYED", 409, "คำขอนี้ถูกส่งซ้ำ"),
  signatureInvalid: () => new AgentError("AGENT_SIGNATURE_INVALID", 401, "ยืนยันตัวตนไม่สำเร็จ"),
  installationInactive: () => new AgentError("AGENT_INSTALLATION_INACTIVE", 403, "การติดตั้งนี้ถูกปิดใช้งาน"),
  facilityInactive: () => new AgentError("AGENT_FACILITY_INACTIVE", 403, "สถานบริการนี้ถูกปิดใช้งาน"),
  officeMismatch: () => new AgentError("AGENT_OFFICE_MISMATCH", 409, "office.offid ไม่ตรงกับสถานบริการที่ลงทะเบียนไว้"),
  sessionInvalid: () => new AgentError("AGENT_SESSION_INVALID", 409, "ไม่พบ sync session ที่กำลังรับข้อมูล"),
  batchInvalid: () => new AgentError("AGENT_BATCH_INVALID", 400, "batch ไม่ถูกต้อง"),
  rowCountMismatch: (expected: number, received: number) =>
    new AgentError("AGENT_ROW_COUNT_MISMATCH", 409, `จำนวนแถวไม่ครบ (คาด ${expected} ได้รับ ${received})`),
  enrollmentInvalid: () => new AgentError("AGENT_ENROLLMENT_INVALID", 400, "enrollment token ไม่ถูกต้องหรือหมดอายุ"),
  possibleDuplicate: () => new AgentError("AGENT_POSSIBLE_DUPLICATE", 409, "พบ Agent ที่อาจเป็นเครื่องเดิม กรุณาให้ผู้ดูแลเลือก re-enroll Agent เดิมหรือยืนยันว่าเป็นเครื่องใหม่"),
  commandInvalid: () => new AgentError("AGENT_COMMAND_INVALID", 409, "ไม่พบคำสั่งที่ Agent นี้ถือครองอยู่"),
  payloadTooLarge: () => new AgentError("AGENT_PAYLOAD_TOO_LARGE", 413, "payload ใหญ่เกินกำหนด"),
  // The field name is safe to return: it names the request shape, never a value.
  bodyInvalid: (field?: string) =>
    new AgentError("AGENT_BODY_INVALID", 400, field ? `รูปแบบข้อมูลไม่ถูกต้องที่ฟิลด์ ${field}` : "รูปแบบข้อมูลไม่ถูกต้อง"),
} as const;
