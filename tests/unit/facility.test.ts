import { describe, expect, it } from "vitest";
import { isValidOfficeId } from "@/lib/poc/facility";

describe("isValidOfficeId", () => {
  it.each(["05957", "12345", "90001"])("accepts %s", (value) => {
    expect(isValidOfficeId(value)).toBe(true);
  });

  it.each(["00001", "00009", "1234", "123456", "12A45", ""])("rejects %s", (value) => {
    expect(isValidOfficeId(value)).toBe(false);
  });
});
