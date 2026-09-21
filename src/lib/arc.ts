import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  toBytes,
  toHex,
  zeroHash,
  type Address,
} from "viem";
import { arc } from "viem/chains";
import type { RiskReport } from "../core/risk";

export const ARC_CHAIN_ID = 5042;
export const ARC_RPC_URL = "https://rpc.mainnet.arc.io";
export const ARC_EXPLORER_URL = "https://explorer.arc.io";
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" satisfies Address;
export const DENYLIST_ADDRESS =
  "0x3600000000000000000000000000000000000004" satisfies Address;
export const MEMO_ADDRESS =
  "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" satisfies Address;
export const RULESET_VERSION = "arcshield-2026-09-21";

const ARC_CHAIN_HEX = "0x13b2";

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const denylistAbi = parseAbi([
  "function isDenylisted(address account) view returns (bool)",
]);
const memoAbi = parseAbi([
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
]);

if (arc.id !== ARC_CHAIN_ID) {
  throw new Error("Viem Arc chain configuration has an unexpected chain id.");
}

const publicClient = createPublicClient({
  chain: arc,
  transport: http(ARC_RPC_URL),
});

export type ArcShieldErrorCode =
  | "INVALID_AMOUNT"
  | "PROVIDER_UNAVAILABLE"
  | "USER_REJECTED"
  | "WRONG_NETWORK"
  | "INSUFFICIENT_FUNDS"
  | "SIMULATION_FAILURE"
  | "RPC_FAILURE";

export class ArcShieldError extends Error {
  readonly code: ArcShieldErrorCode;

  constructor(code: ArcShieldErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ArcShieldError";
    this.code = code;
  }
}

export interface BuildMemoPaymentInput {
  account: Address;
  recipient: Address;
  amount: string;
  report: RiskReport;
  operationId: string;
}

export function hashWebsite(normalizedWebsite?: string): `0x${string}` {
  return normalizedWebsite ? keccak256(toBytes(normalizedWebsite)) : zeroHash;
}

export async function inspectRecipient(address: Address) {
  try {
    const [code, denylisted] = await Promise.all([
      publicClient.getCode({ address }),
      publicClient.readContract({
        address: DENYLIST_ADDRESS,
        abi: denylistAbi,
        functionName: "isDenylisted",
        args: [address],
      }),
    ]);

    return { hasCode: code !== undefined && code !== "0x", denylisted };
  } catch (error) {
    throw mapArcError(error, "RPC_FAILURE");
  }
}

export function buildMemoPayment({
  account,
  recipient,
  amount,
  report,
  operationId,
}: BuildMemoPaymentInput) {
  let units: bigint;
  try {
    units = parseUnits(amount, 6);
  } catch (error) {
    throw new ArcShieldError(
      "INVALID_AMOUNT",
      "Enter a valid USDC amount greater than zero.",
      error,
    );
  }
  if (units <= 0n) {
    throw new ArcShieldError(
      "INVALID_AMOUNT",
      "Enter a valid USDC amount greater than zero.",
    );
  }

  const transferCalldata = encodeFunctionData({
    abi: usdcAbi,
    functionName: "transfer",
    args: [recipient, units],
  });
  const memoData = toHex(
    JSON.stringify({
      schema: "arcshield-payment-receipt",
      urlHash: hashWebsite(report.normalizedWebsite),
      riskLevel: report.level,
      reasonCodes: report.codes,
      ruleset: RULESET_VERSION,
    }),
  );

  return {
    account,
    address: MEMO_ADDRESS,
    abi: memoAbi,
    functionName: "memo" as const,
    args: [
      USDC_ADDRESS,
      transferCalldata,
      keccak256(toBytes(operationId)),
      memoData,
    ] as const,
  } as const;
}

export async function connectWallet(): Promise<Address> {
  const walletClient = getWalletClient();
  try {
    const [account] = await walletClient.requestAddresses();
    if (!account) {
      throw new ArcShieldError(
        "PROVIDER_UNAVAILABLE",
        "No wallet account is available. Unlock your browser wallet and try again.",
      );
    }
    return account;
  } catch (error) {
    throw mapArcError(error, "RPC_FAILURE");
  }
}

export async function switchToArc(): Promise<void> {
  const provider = getInjectedProvider();
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_CHAIN_HEX }],
    });
  } catch (error) {
    if (!hasErrorCode(error, 4902)) {
      throw mapArcError(error, "WRONG_NETWORK");
    }

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ARC_CHAIN_HEX,
            chainName: "Arc",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: [ARC_RPC_URL],
            blockExplorerUrls: [ARC_EXPLORER_URL],
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_HEX }],
      });
    } catch (addError) {
      throw mapArcError(addError, "RPC_FAILURE");
    }
  }
}

export async function sendGuardedPayment(payment: ReturnType<typeof buildMemoPayment>) {
  const request = await simulateMemoPayment(payment);
  const walletClient = getWalletClient();

  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract(request);
  } catch (error) {
    throw mapArcError(error, "RPC_FAILURE");
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new ArcShieldError(
        "RPC_FAILURE",
        "The payment transaction did not complete successfully.",
      );
    }
    return { hash, receipt };
  } catch (error) {
    throw mapArcError(error, "RPC_FAILURE");
  }
}

async function simulateMemoPayment(payment: ReturnType<typeof buildMemoPayment>) {
  try {
    const { request } = await publicClient.simulateContract(payment);
    return request;
  } catch (error) {
    throw mapArcError(error, "SIMULATION_FAILURE");
  }
}

function getInjectedProvider(): NonNullable<Window["ethereum"]> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new ArcShieldError(
      "PROVIDER_UNAVAILABLE",
      "No browser wallet was found. Install or unlock a compatible wallet and try again.",
    );
  }
  return window.ethereum;
}

function getWalletClient() {
  return createWalletClient({
    chain: arc,
    transport: custom(getInjectedProvider()),
  });
}

function hasErrorCode(error: unknown, code: number): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function errorDescription(error: unknown): string {
  let current = error;
  const messages: string[] = [];
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    if ("name" in current && typeof current.name === "string") messages.push(current.name);
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return messages.join(" ").toLowerCase();
}

function mapArcError(
  error: unknown,
  fallback: Extract<ArcShieldErrorCode, "WRONG_NETWORK" | "SIMULATION_FAILURE" | "RPC_FAILURE">,
): ArcShieldError {
  if (error instanceof ArcShieldError) return error;
  if (hasErrorCode(error, 4001)) {
    return new ArcShieldError("USER_REJECTED", "The wallet request was cancelled.", error);
  }

  const description = errorDescription(error);
  if (
    description.includes("insufficient funds") ||
    description.includes("insufficientfundserror")
  ) {
    return new ArcShieldError(
      "INSUFFICIENT_FUNDS",
      "The wallet does not have enough USDC to cover the payment and network fee.",
      error,
    );
  }
  if (
    description.includes("chain mismatch") ||
    description.includes("chainmismatcherror") ||
    description.includes("does not match the target chain") ||
    description.includes("wrong network")
  ) {
    return new ArcShieldError(
      "WRONG_NETWORK",
      "Switch your wallet to Arc mainnet and try again.",
      error,
    );
  }

  const messages = {
    WRONG_NETWORK: "Switch your wallet to Arc mainnet and try again.",
    SIMULATION_FAILURE: "The payment could not be simulated safely and was not sent.",
    RPC_FAILURE: "The Arc network request failed. Try again shortly.",
  } as const;
  return new ArcShieldError(fallback, messages[fallback], error);
}
