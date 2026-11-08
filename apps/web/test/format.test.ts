import { describe, expect, it } from "vitest";
import { changeLabel, displayEmail, formatDateTime, statusLabel, truncate } from "../src/lib/format";

describe("format helpers", () => {
  it("formats ISO timestamps", () => {
    const formatted = formatDateTime("2026-11-04T01:00:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/\d{2}:\d{2}/);
  });

  it("returns a placeholder for empty values", () => {
    expect(formatDateTime(null)).toBe("-");
  });

  it("maps change kinds to Chinese labels", () => {
    expect(changeLabel("person_removed")).toBe("离职或移出");
    expect(changeLabel("unknown_kind")).toBe("unknown_kind");
  });

  it("maps statuses and prefers primary email", () => {
    expect(statusLabel("resigned")).toBe("离职");
    expect(displayEmail({ email: null, enterpriseEmail: "work@example.com" })).toBe("work@example.com");
    expect(displayEmail({ email: null, enterpriseEmail: null })).toBe("-");
  });

  it("truncates long text", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
