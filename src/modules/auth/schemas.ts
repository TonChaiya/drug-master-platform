import { z } from "zod";
import { isValidOfficeId } from "@/lib/validation/facility";

/**
 * The username and password policies, defined once.
 *
 * Exported because the admin screen sets both as well, and a second copy of the
 * rules there would drift from these the first time one of them changed.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(4, "ไอดีต้องยาวอย่างน้อย 4 ตัวอักษร")
  .max(80, "ไอดียาวเกิน 80 ตัวอักษร")
  .regex(/^[A-Za-z0-9._-]+$/, "ไอดีใช้ได้เฉพาะอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง");

/** Policy for a password being SET. Enforced on signup and on any change. */
export const newPasswordSchema = z
  .string()
  .min(6, "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร")
  .max(128, "รหัสผ่านยาวเกิน 128 ตัวอักษร");

const username = usernameSchema;
const newPassword = newPasswordSchema;

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
