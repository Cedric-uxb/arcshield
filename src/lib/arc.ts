import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
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
  | "CONTRACT_REVERTED"
  | "RPC_FAILURE"
  | "TRANSACTION_CANCELLED"
  | "TRANSACTION_REPLACED"
  | "TRANSACTION_STATUS_UNKNOWN"
  | "TRANSACTION_REVERTED"
  | "UNSUPPORTED_ACCOUNT";

export class ArcShieldError extends Error {
  readonly code: ArcShieldErrorCode;
  readonly transactionHash?: `0x${string}`;

  constructor(
    code: ArcShieldErrorCode,
    message: string,
    cause?: unknown,
    transactionHash?: `0x${string}`,
  ) {
    super(message, { cause });
    this.name = "ArcShieldError";
    this.code = code;
    if (transactionHash) this.transactionHash = transactionHash;
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
  const normalizedAmount = amount.trim();
  const fractionalDigits = normalizedAmount.match(/^\d+\.(\d+)$/)?.[1];
  if (fractionalDigits && fractionalDigits.length > 6) {
    throw new ArcShieldError(
      "INVALID_AMOUNT",
      "USDC amounts can have at most six decimal places.",
    );
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalizedAmount)) {
    throw new ArcShieldError(
      "INVALID_AMOUNT",
      "Enter a valid USDC amount greater than zero.",
    );
  }

  let units: bigint;
  try {
    units = parseUnits(normalizedAmount, 6);
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

export async function getWalletChainId(): Promise<number> {
  const provider = getInjectedProvider();
  try {
    const chainId = await provider.request({ method: "eth_chainId" });
    if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) {
      throw new Error("The wallet returned an invalid chain id.");
    }
    const parsedChainId = Number.parseInt(chainId, 16);
    if (!Number.isSafeInteger(parsedChainId)) {
      throw new Error("The wallet returned an invalid chain id.");
    }
    return parsedChainId;
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
  await preflightPayment(payment);
  const request = await simulateMemoPayment(payment);
  const walletClient = getWalletClient();

  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract(request);
  } catch (error) {
    throw mapArcError(error, "RPC_FAILURE");
  }

  let replacement:
    | {
        reason: "cancelled" | "replaced" | "repriced";
        hash: `0x${string}`;
      }
    | undefined;
  let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash,
      onReplaced: ({ reason, transactionReceipt }) => {
        replacement = { reason, hash: transactionReceipt.transactionHash };
      },
    });
  } catch (error) {
    throw new ArcShieldError(
      "TRANSACTION_STATUS_UNKNOWN",
      "The payment was broadcast, but its final status could not be confirmed. Do not resubmit until the transaction hash has been checked in the Arc explorer.",
      error,
      hash,
    );
  }
  const finalHash = receipt.transactionHash;
  if (replacement?.reason === "replaced") {
    throw new ArcShieldError(
      "TRANSACTION_REPLACED",
      "The Arc payment was replaced by a different transaction. Inspect the replacement transaction before retrying.",
      undefined,
      replacement.hash,
    );
  }
  if (replacement?.reason === "cancelled") {
    throw new ArcShieldError(
      "TRANSACTION_CANCELLED",
      "The Arc payment was cancelled by a replacement transaction. Inspect the cancellation transaction before retrying.",
      undefined,
      replacement.hash,
    );
  }
  if (receipt.status !== "success") {
    throw new ArcShieldError(
      "TRANSACTION_REVERTED",
      "The payment transaction was mined but reverted.",
      undefined,
      finalHash,
    );
  }
  return { hash: finalHash, receipt };
}

async function preflightPayment(payment: ReturnType<typeof buildMemoPayment>) {
  let accountCode: `0x${string}` | undefined;
  try {
    accountCode = await publicClient.getCode({ address: payment.account });
  } catch (error) {
    throw mapArcError(error, "RPC_FAILURE");
  }
  if (accountCode !== undefined && accountCode !== "0x") {
    throw new ArcShieldError(
      "UNSUPPORTED_ACCOUNT",
      "Arc Memo payments require an externally owned wallet account; contract accounts are not supported.",
    );
  }

  let balance: bigint;
  try {
    balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [payment.account],
    });
  } catch (error) {
    throw mapArcError(error, "RPC_FAILURE");
  }

  const transfer = decodeFunctionData({ abi: usdcAbi, data: payment.args[1] });
  if (transfer.functionName !== "transfer") {
    throw new ArcShieldError(
      "SIMULATION_FAILURE",
      "The payment transfer data is invalid and was not sent.",
    );
  }
  if (balance < transfer.args[1]) {
    throw new ArcShieldError(
      "INSUFFICIENT_FUNDS",
      "The wallet does not have enough USDC for this payment.",
    );
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
  if (
    description.includes("contractfunctionrevertederror")
  ) {
    if (fallback !== "SIMULATION_FAILURE") {
      return new ArcShieldError(
        "CONTRACT_REVERTED",
        "The payment contract call reverted and no transaction hash was returned.",
        error,
      );
    }
    return new ArcShieldError(
      "SIMULATION_FAILURE",
      "The payment could not be simulated safely and was not sent.",
      error,
    );
  }
  if (
    description.includes("rpcrequesterror") ||
    description.includes("httprequesterror") ||
    description.includes("providerrpcerror") ||
    description.includes("websocketrequesterror") ||
    description.includes("socketclosederror") ||
    description.includes("timeout") ||
    description.includes("network error") ||
    description.includes("failed to fetch") ||
    hasErrorCode(error, -32603)
  ) {
    return new ArcShieldError(
      "RPC_FAILURE",
      "The Arc network request failed. Try again shortly.",
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
