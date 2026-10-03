import {
  bytesToHex,
  consensusIdenticalAggregation,
  cre,
  encodeCallMsg,
  getNetwork,
  HTTPClient,
  HTTPCapability,
  LAST_FINALIZED_BLOCK_NUMBER,
  type HTTPPayload,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddress,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";

export const configSchema = z.object({
  chainSelectorName: z.string(),
  blocklistContractAddress: z
    .string()
    .refine(isAddress, "Invalid blocklist contract address"),
  rdapBaseUrl: z.string().min(1),
  newDomainDays: z.number().int().positive(),
});

type Config = z.infer<typeof configSchema>;

const payloadSchema = z.object({
  recipient: z.string().refine(isAddress, "Invalid recipient address"),
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
    // ponytail: direct Verisign RDAP avoids redirects; add IANA routing when other TLDs matter.
    .refine((hostname) => hostname.endsWith(".com"), "Only .com RDAP is supported"),
  observedAt: z.string().datetime(),
  localRiskLevel: z.enum(["low", "warning", "high"]),
  localReasonCodes: z.array(z.string().min(1).max(64)).max(20),
  ruleset: z.string().min(1).max(64),
});

type Payload = z.infer<typeof payloadSchema>;

type DomainEvidence = {
  registeredAt: string;
  status: "found" | "not_found";
};

export type ComplianceDecision = {
  decision: "allow" | "review" | "block";
  reasonCodes: string[];
  domainAgeDays: number | null;
};

const blocklistAbi = [
  {
    type: "function",
    name: "isBlacklisted",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function decideCompliance(
  payload: Pick<Payload, "localRiskLevel" | "observedAt">,
  denylisted: boolean,
  registeredAt: string | null,
  newDomainDays: number,
): ComplianceDecision {
  const reasonCodes: string[] = [];
  let decision: ComplianceDecision["decision"] = "allow";

  if (denylisted) {
    decision = "block";
    reasonCodes.push("ARC_DENYLIST_MATCH");
  }
  if (payload.localRiskLevel === "high") {
    decision = "block";
    reasonCodes.push("LOCAL_HIGH_RISK");
  } else if (payload.localRiskLevel === "warning" && decision !== "block") {
    decision = "review";
    reasonCodes.push("LOCAL_WARNING");
  }

  const parsedDomainAgeDays = registeredAt
    ? Math.floor(
        (Date.parse(payload.observedAt) - Date.parse(registeredAt)) / 86_400_000,
      )
    : null;
  const domainAgeDays =
    parsedDomainAgeDays !== null && Number.isFinite(parsedDomainAgeDays)
      ? parsedDomainAgeDays
      : null;

  if (domainAgeDays === null) {
    if (decision === "allow") decision = "review";
    reasonCodes.push("DOMAIN_AGE_UNKNOWN");
  } else if (domainAgeDays < newDomainDays) {
    if (decision === "allow") decision = "review";
    reasonCodes.push("DOMAIN_NEWLY_REGISTERED");
  }

  return { decision, reasonCodes, domainAgeDays };
}

function readArcBlocklist(
  runtime: Runtime<Config>,
  recipient: Address,
): boolean {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  });
  if (!network) {
    throw new Error(`Unsupported CRE network: ${runtime.config.chainSelectorName}`);
  }

  const client = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const callData = encodeFunctionData({
    abi: blocklistAbi,
    functionName: "isBlacklisted",
    args: [recipient],
  });
  const response = client
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.blocklistContractAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  return decodeFunctionResult({
    abi: blocklistAbi,
    functionName: "isBlacklisted",
    data: bytesToHex(response.data),
  });
}

function fetchDomainEvidence(
  runtime: Runtime<Config>,
  hostname: string,
): DomainEvidence {
  return runtime
    .runInNodeMode(
      (nodeRuntime: NodeRuntime<Config>) => {
        const response = new HTTPClient()
          .sendRequest(nodeRuntime, {
            method: "GET",
            url: `${nodeRuntime.config.rdapBaseUrl}${encodeURIComponent(hostname)}`,
            headers: { Accept: "application/rdap+json" },
          })
          .result();

        if (response.statusCode === 404) {
          return { registeredAt: "", status: "not_found" as const };
        }
        if (response.statusCode !== 200) {
          throw new Error(`RDAP returned HTTP ${response.statusCode}`);
        }

        const body = JSON.parse(new TextDecoder().decode(response.body)) as {
          events?: Array<{ eventAction?: string; eventDate?: string }>;
        };
        const registeredAt =
          body.events?.find((event) => event.eventAction === "registration")
            ?.eventDate ?? null;
        return { registeredAt, status: "found" as const };
      },
      consensusIdenticalAggregation<DomainEvidence>(),
    )()
    .result();
}

export function onHttpTrigger(runtime: Runtime<Config>, raw: HTTPPayload) {
  if (!raw.input?.length) throw new Error("HTTP trigger payload is required");

  const payload = payloadSchema.parse(
    JSON.parse(new TextDecoder().decode(raw.input)),
  );
  const denylisted = readArcBlocklist(runtime, payload.recipient as Address);
  const domainEvidence = fetchDomainEvidence(runtime, payload.hostname);
  const result = decideCompliance(
    payload,
    denylisted,
    domainEvidence.registeredAt || null,
    runtime.config.newDomainDays,
  );

  const evidence = {
    decision: result.decision,
    reasonCodes: result.reasonCodes,
    domainAgeDays: result.domainAgeDays ?? -1,
    recipient: payload.recipient,
    hostname: payload.hostname,
    localReasonCodes: payload.localReasonCodes,
    ruleset: payload.ruleset,
    arcDenylisted: denylisted,
    rdapStatus: domainEvidence.status,
    registeredAt: domainEvidence.registeredAt || "unknown",
  };
  runtime.log(JSON.stringify(evidence));
  return evidence;
}

export function initWorkflow(_config: Config) {
  const http = new HTTPCapability();
  return [cre.handler(http.trigger({}), onHttpTrigger)];
}
