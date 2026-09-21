import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { analyzePayment, type PaymentInput, type RiskCode } from "./risk";

const account = "0x1111111111111111111111111111111111111111";

describe("analyzePayment", () => {
  it("marks an invalid recipient as high risk", () => {
    expect(analyzePayment({ recipient: "bad" }).level).toBe("high");
  });

  it.each<[string, PaymentInput, RiskCode]>([
    ["zero address", { recipient: zeroAddress }, "ADDRESS_ZERO"],
    ["self payment", { recipient: account, sender: account }, "ADDRESS_SELF"],
    [
      "HTTP website",
      { recipient: account, website: "http://example.com" },
      "URL_NO_HTTPS",
    ],
    [
      "IPv4 host",
      { recipient: account, website: "https://127.0.0.1/login" },
      "URL_IP_HOST",
    ],
    [
      "bracketed IPv6 host",
      { recipient: account, website: "https://[::1]/login" },
      "URL_IP_HOST",
    ],
    [
      "URL credentials",
      { recipient: account, website: "https://user:pass@example.com" },
      "URL_CREDENTIALS",
    ],
    [
      "punycode host",
      { recipient: account, website: "https://xn--pple-43d.com" },
      "URL_PUNYCODE",
    ],
    [
      "many hostname labels",
      { recipient: account, website: "https://a.b.c.d.example.com" },
      "URL_MANY_SUBDOMAINS",
    ],
    [
      "long hostname",
      {
        recipient: account,
        website: `https://${"a".repeat(30)}.${"b".repeat(30)}.${"c".repeat(30)}.com`,
      },
      "URL_LONG_HOST",
    ],
    ["invalid URL", { recipient: account, website: "not a URL" }, "URL_INVALID"],
  ])("reports %s", (_name, input, expectedCode) => {
    expect(analyzePayment(input).codes).toContain(expectedCode);
  });

  it("keeps a normal HTTPS payment low risk", () => {
    expect(
      analyzePayment({ recipient: account, website: "https://pay.example.com" }).level,
    ).toBe("low");
  });

  it("marks denylisted recipients as high risk", () => {
    const report = analyzePayment({ recipient: account, recipientDenylisted: true });

    expect(report.level).toBe("high");
    expect(report.codes).toContain("ADDRESS_DENYLISTED");
  });

  it("marks contract recipients as a warning", () => {
    const report = analyzePayment({ recipient: account, recipientHasCode: true });

    expect(report.level).toBe("warning");
    expect(report.codes).toContain("ADDRESS_CONTRACT");
  });

  it("deduplicates findings and uses the highest triggered severity", () => {
    const report = analyzePayment({
      recipient: zeroAddress,
      sender: zeroAddress,
      website: "http://127.0.0.1",
      recipientHasCode: true,
      recipientDenylisted: true,
    });
    const findingCodes = report.findings.map(({ code }) => code);

    expect(report.level).toBe("high");
    expect(report.codes).toEqual([...new Set(report.codes)]);
    expect(findingCodes).toEqual([...new Set(findingCodes)]);
    expect(findingCodes).toEqual(report.codes);
  });

  it("returns stable explanatory metadata and only present normalizations", () => {
    const input = { recipient: account, website: "http://example.com" };

    expect(analyzePayment(input)).toMatchObject({
      normalizedRecipient: account,
      normalizedWebsite: "http://example.com/",
      findings: [
        {
          code: "URL_NO_HTTPS",
          level: "warning",
          title: "Website does not use HTTPS",
          detail: "The associated website does not use an encrypted HTTPS connection.",
        },
      ],
    });
    expect(analyzePayment({ recipient: "bad", website: "not a URL" })).not.toHaveProperty(
      "normalizedRecipient",
    );
    expect(analyzePayment({ recipient: "bad", website: "not a URL" })).not.toHaveProperty(
      "normalizedWebsite",
    );
  });
});
