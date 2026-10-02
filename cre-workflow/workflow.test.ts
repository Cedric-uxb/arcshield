import { describe, expect, test } from "bun:test";
import { decideCompliance } from "./workflow";

const payload = {
  localRiskLevel: "low" as const,
  observedAt: "2026-10-02T15:00:00.000Z",
};

describe("decideCompliance", () => {
  test("blocks Arc denylist matches", () => {
    expect(
      decideCompliance(payload, true, "1995-08-14T04:00:00Z", 30),
    ).toMatchObject({
      decision: "block",
      reasonCodes: ["ARC_DENYLIST_MATCH"],
    });
  });

  test("requires review when domain age is unknown", () => {
    expect(decideCompliance(payload, false, null, 30)).toEqual({
      decision: "review",
      reasonCodes: ["DOMAIN_AGE_UNKNOWN"],
      domainAgeDays: null,
    });
  });

  test("treats an invalid RDAP registration date as unknown", () => {
    expect(decideCompliance(payload, false, "not-a-date", 30)).toEqual({
      decision: "review",
      reasonCodes: ["DOMAIN_AGE_UNKNOWN"],
      domainAgeDays: null,
    });
  });

  test("allows low-risk evidence for an established domain", () => {
    expect(
      decideCompliance(payload, false, "1995-08-14T04:00:00Z", 30),
    ).toMatchObject({ decision: "allow", reasonCodes: [] });
  });
});
