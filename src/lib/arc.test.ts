import {
  decodeFunctionData,
  encodeFunctionData,
  hexToString,
  keccak256,
  parseAbi,
  toBytes,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import type { RiskReport } from "../core/risk";
import {
  ARC_CHAIN_ID,
  MEMO_ADDRESS,
  RULESET_VERSION,
  USDC_ADDRESS,
  buildMemoPayment,
} from "./arc";

const memoAbi = parseAbi([
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
]);
const usdcAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const normalizedWebsite = "https://pay.example.com/invoice/42?source=email";
const report: RiskReport = {
  level: "warning",
  codes: ["URL_MANY_SUBDOMAINS", "ADDRESS_CONTRACT"],
  findings: [],
  normalizedRecipient: recipient,
  normalizedWebsite,
};

const input = {
  account,
  recipient,
  amount: "1.25",
  report,
  operationId: "payment-42",
} as const;

describe("buildMemoPayment", () => {
  it("uses Arc mainnet chain id 5042", () => {
    expect(ARC_CHAIN_ID).toBe(5042);
  });

  it("encodes an atomic memo-wrapped USDC payment without the raw URL", () => {
    const payment = buildMemoPayment(input);
    const encodedCall = encodeFunctionData({
      abi: payment.abi,
      functionName: payment.functionName,
      args: payment.args,
    });

    expect(payment.address).toBe(MEMO_ADDRESS);

    const outer = decodeFunctionData({ abi: memoAbi, data: encodedCall });
    expect(outer.functionName).toBe("memo");
    const [target, transferCalldata, memoId, memoData] = outer.args;
    expect(target).toBe(USDC_ADDRESS);
    expect(memoId).toBe(keccak256(toBytes(input.operationId)));

    const transfer = decodeFunctionData({ abi: usdcAbi, data: transferCalldata });
    expect(transfer.functionName).toBe("transfer");
    expect(transfer.args).toEqual([recipient, 1_250_000n]);

    const memoJson = hexToString(memoData);
    expect(JSON.parse(memoJson)).toEqual({
      schema: "arcshield-payment-receipt",
      urlHash: keccak256(toBytes(normalizedWebsite)),
      riskLevel: "warning",
      reasonCodes: ["URL_MANY_SUBDOMAINS", "ADDRESS_CONTRACT"],
      ruleset: RULESET_VERSION,
    });
    expect(memoJson).toBe(
      JSON.stringify({
        schema: "arcshield-payment-receipt",
        urlHash: keccak256(toBytes(normalizedWebsite)),
        riskLevel: "warning",
        reasonCodes: ["URL_MANY_SUBDOMAINS", "ADDRESS_CONTRACT"],
        ruleset: RULESET_VERSION,
      }),
    );
    expect(encodedCall.toLowerCase()).not.toContain(
      toHex(normalizedWebsite).slice(2).toLowerCase(),
    );
    expect(memoJson).not.toContain(normalizedWebsite);
  });

  it.each(["0", "-0.000001"])("rejects non-positive amount %s", (amount) => {
    expect(() => buildMemoPayment({ ...input, amount })).toThrow(/greater than zero/i);
  });

  it("rejects an invalid amount", () => {
    expect(() => buildMemoPayment({ ...input, amount: "not-a-number" })).toThrow(
      /amount/i,
    );
  });
});
