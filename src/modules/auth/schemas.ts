import { z } from "zod";
import { isValidOfficeId } from "@/lib/validation/facility";

const username = z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9._-]+$/);

/** Policy for a password being SET. Enforced on signup and password change. */
const newPassword = z.string().min(6).max(128);

/**
 * Login only compares a credential, so it must not re-apply the policy: an
 * account created before a policy change, or a bootstrap account, still has to
 * be able to sign in. The cap is only there to bound hashing work.
 */
const submittedPassword = z.string().min(1).max(128);

export const signupSchema = z.object({
  username,
  password: newPassword,
  fullName: z.string().trim().min(2).max(255),
  positionName: z.string().trim().min(2).max(160),
  facilityCode: z.string().refine(isValidOfficeId),
  facilityName: z.string().trim().min(2).max(255),
}).strict();

export const loginSchema = z.object({ username, password: submittedPassword }).strict();

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
