import {
  decodeFunctionData,
  encodeFunctionData,
  hexToString,
  keccak256,
  parseAbi,
  toBytes,
  toHex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskReport } from "../core/risk";

const clients = vi.hoisted(() => ({
  providerRequest: vi.fn(),
  publicClient: {
    getCode: vi.fn(),
    readContract: vi.fn(),
    simulateContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  },
  walletClient: {
    requestAddresses: vi.fn(),
    writeContract: vi.fn(),
  },
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => clients.publicClient,
    createWalletClient: () => clients.walletClient,
  };
});

import {
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ARC_RPC_URL,
  DENYLIST_ADDRESS,
  MEMO_ADDRESS,
  RULESET_VERSION,
  USDC_ADDRESS,
  buildMemoPayment,
  connectWallet,
  inspectRecipient,
  sendGuardedPayment,
  switchToArc,
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

const transactionHash = `0x${"ab".repeat(32)}` as const;

beforeEach(() => {
  clients.providerRequest.mockReset().mockResolvedValue(null);
  clients.publicClient.getCode.mockReset().mockResolvedValue(undefined);
  clients.publicClient.readContract.mockReset().mockResolvedValue(2_000_000n);
  clients.publicClient.simulateContract.mockReset().mockImplementation(async (request) => ({
    request,
  }));
  clients.publicClient.waitForTransactionReceipt
    .mockReset()
    .mockResolvedValue({ status: "success", transactionHash });
  clients.walletClient.requestAddresses.mockReset().mockResolvedValue([account]);
  clients.walletClient.writeContract.mockReset().mockResolvedValue(transactionHash);

  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: { request: clients.providerRequest },
  });
});

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

  it("accepts an amount with exactly six decimal places", () => {
    const payment = buildMemoPayment({ ...input, amount: "0.000001" });
    const transfer = decodeFunctionData({ abi: usdcAbi, data: payment.args[1] });

    expect(transfer.args).toEqual([recipient, 1n]);
  });

  it.each(["0.0000005", "1.0000005"])(
    "rejects an amount with more than six decimal places: %s",
    (amount) => {
      expect(() => buildMemoPayment({ ...input, amount })).toThrow(/six decimal places/i);
    },
  );

  it("rejects an invalid amount", () => {
    expect(() => buildMemoPayment({ ...input, amount: "not-a-number" })).toThrow(
      /amount/i,
    );
  });
});

describe("Arc reads and wallet operations", () => {
  it("reports recipient code and denylist status", async () => {
    clients.publicClient.getCode.mockResolvedValue("0x6000");
    clients.publicClient.readContract.mockResolvedValue(true);

    await expect(inspectRecipient(recipient)).resolves.toEqual({
      hasCode: true,
      denylisted: true,
    });
    expect(clients.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: DENYLIST_ADDRESS,
        functionName: "isDenylisted",
        args: [recipient],
      }),
    );

    clients.publicClient.getCode.mockResolvedValue("0x");
    clients.publicClient.readContract.mockResolvedValue(false);
    await expect(inspectRecipient(recipient)).resolves.toEqual({
      hasCode: false,
      denylisted: false,
    });
  });

  it("maps provider code 4001 to USER_REJECTED", async () => {
    clients.walletClient.requestAddresses.mockRejectedValue(
      Object.assign(new Error("rejected"), { code: 4001 }),
    );

    await expect(connectWallet()).rejects.toMatchObject({ code: "USER_REJECTED" });
  });

  it("adds Arc with the official config after switch returns 4902", async () => {
    clients.providerRequest
      .mockRejectedValueOnce(Object.assign(new Error("unknown chain"), { code: 4902 }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await switchToArc();

    expect(clients.providerRequest.mock.calls).toEqual([
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: "0x13b2" }] }],
      [
        {
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x13b2",
              chainName: "Arc",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [ARC_RPC_URL],
              blockExplorerUrls: [ARC_EXPLORER_URL],
            },
          ],
        },
      ],
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: "0x13b2" }] }],
    ]);
  });

  it("maps a chain mismatch to WRONG_NETWORK", async () => {
    clients.providerRequest.mockRejectedValue(
      Object.assign(new Error("chain mismatch"), { name: "ChainMismatchError" }),
    );

    await expect(switchToArc()).rejects.toMatchObject({ code: "WRONG_NETWORK" });
  });

  it("preflights the account and balance before simulate -> write -> wait", async () => {
    const sequence: string[] = [];
    clients.publicClient.getCode.mockImplementation(async () => {
      sequence.push("account-code");
      return undefined;
    });
    clients.publicClient.readContract.mockImplementation(async () => {
      sequence.push("balance");
      return 2_000_000n;
    });
    clients.publicClient.simulateContract.mockImplementation(async (request) => {
      sequence.push("simulate");
      return { request };
    });
    clients.walletClient.writeContract.mockImplementation(async () => {
      sequence.push("write");
      return transactionHash;
    });
    clients.publicClient.waitForTransactionReceipt.mockImplementation(async () => {
      sequence.push("wait");
      return { status: "success", transactionHash };
    });

    await sendGuardedPayment(buildMemoPayment(input));

    expect(sequence).toEqual(["account-code", "balance", "simulate", "write", "wait"]);
    expect(clients.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: USDC_ADDRESS,
        functionName: "balanceOf",
        args: [account],
      }),
    );
  });

  it("rejects an insufficient USDC balance before simulation", async () => {
    clients.publicClient.readContract.mockResolvedValue(1_249_999n);

    await expect(
      sendGuardedPayment(buildMemoPayment(input)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(clients.publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it("maps simulation transport errors to RPC_FAILURE", async () => {
    clients.publicClient.simulateContract.mockRejectedValue(
      Object.assign(new Error("RPC unavailable"), { name: "RpcRequestError" }),
    );

    await expect(
      sendGuardedPayment(buildMemoPayment(input)),
    ).rejects.toMatchObject({ code: "RPC_FAILURE" });
  });

  it("maps contract rejection to SIMULATION_FAILURE", async () => {
    clients.publicClient.simulateContract.mockRejectedValue(
      Object.assign(new Error("execution reverted"), {
        name: "ContractFunctionRevertedError",
      }),
    );

    await expect(
      sendGuardedPayment(buildMemoPayment(input)),
    ).rejects.toMatchObject({ code: "SIMULATION_FAILURE" });
  });

  it("maps a reverted mined receipt to TRANSACTION_REVERTED", async () => {
    clients.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: "reverted",
      transactionHash,
    });

    await expect(
      sendGuardedPayment(buildMemoPayment(input)),
    ).rejects.toMatchObject({ code: "TRANSACTION_REVERTED" });
  });

  it("rejects contract accounts before simulation", async () => {
    clients.publicClient.getCode.mockResolvedValue("0x6000");

    await expect(
      sendGuardedPayment(buildMemoPayment(input)),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ACCOUNT" });
    expect(clients.publicClient.simulateContract).not.toHaveBeenCalled();
    expect(clients.walletClient.writeContract).not.toHaveBeenCalled();
  });
});
