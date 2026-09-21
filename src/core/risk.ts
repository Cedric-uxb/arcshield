import { getAddress, isAddress, zeroAddress } from "viem";

export type RiskLevel = "low" | "warning" | "high";
export type RiskCode =
  | "ADDRESS_INVALID"
  | "ADDRESS_ZERO"
  | "ADDRESS_SELF"
  | "ADDRESS_CONTRACT"
  | "ADDRESS_DENYLISTED"
  | "URL_INVALID"
  | "URL_NO_HTTPS"
  | "URL_IP_HOST"
  | "URL_CREDENTIALS"
  | "URL_PUNYCODE"
  | "URL_MANY_SUBDOMAINS"
  | "URL_LONG_HOST";

export interface RiskFinding {
  code: RiskCode;
  level: Exclude<RiskLevel, "low">;
  title: string;
  detail: string;
}

export interface PaymentInput {
  recipient: string;
  sender?: string;
  website?: string;
  recipientHasCode?: boolean;
  recipientDenylisted?: boolean;
}

export interface RiskReport {
  level: RiskLevel;
  codes: RiskCode[];
  findings: RiskFinding[];
  normalizedRecipient?: `0x${string}`;
  normalizedWebsite?: string;
}

const FINDINGS = {
  ADDRESS_INVALID: {
    code: "ADDRESS_INVALID",
    level: "high",
    title: "Invalid recipient address",
    detail: "The recipient is not a valid Ethereum address.",
  },
  ADDRESS_ZERO: {
    code: "ADDRESS_ZERO",
    level: "high",
    title: "Zero address",
    detail: "Sending funds to the zero address can make them unrecoverable.",
  },
  ADDRESS_SELF: {
    code: "ADDRESS_SELF",
    level: "high",
    title: "Sender and recipient match",
    detail: "The payment would be sent back to the connected account.",
  },
  ADDRESS_CONTRACT: {
    code: "ADDRESS_CONTRACT",
    level: "warning",
    title: "Contract recipient",
    detail: "The recipient contains contract code rather than being a regular account.",
  },
  ADDRESS_DENYLISTED: {
    code: "ADDRESS_DENYLISTED",
    level: "high",
    title: "Denylisted recipient",
    detail: "Arc's USDC denylist reports this recipient as blocked.",
  },
  URL_INVALID: {
    code: "URL_INVALID",
    level: "warning",
    title: "Invalid website URL",
    detail: "The associated website could not be parsed as a URL.",
  },
  URL_NO_HTTPS: {
    code: "URL_NO_HTTPS",
    level: "warning",
    title: "Website does not use HTTPS",
    detail: "The associated website does not use an encrypted HTTPS connection.",
  },
  URL_IP_HOST: {
    code: "URL_IP_HOST",
    level: "warning",
    title: "Website uses an IP address",
    detail: "The associated website uses an IP address instead of a named host.",
  },
  URL_CREDENTIALS: {
    code: "URL_CREDENTIALS",
    level: "warning",
    title: "Website URL contains credentials",
    detail: "The associated website embeds a username or password in its URL.",
  },
  URL_PUNYCODE: {
    code: "URL_PUNYCODE",
    level: "warning",
    title: "Website uses punycode",
    detail: "The associated website contains an internationalized punycode hostname.",
  },
  URL_MANY_SUBDOMAINS: {
    code: "URL_MANY_SUBDOMAINS",
    level: "warning",
    title: "Website has many hostname labels",
    detail: "The associated website hostname contains more than four labels.",
  },
  URL_LONG_HOST: {
    code: "URL_LONG_HOST",
    level: "warning",
    title: "Website hostname is unusually long",
    detail: "The associated website hostname is longer than 80 characters.",
  },
} as const satisfies Record<RiskCode, RiskFinding>;

function isIpHostname(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;

  const labels = hostname.split(".");
  return (
    labels.length === 4 &&
    labels.every((label) => {
      const value = Number(label);
      return label !== "" && Number.isInteger(value) && value >= 0 && value <= 255;
    })
  );
}

export function analyzePayment(input: PaymentInput): RiskReport {
  const codes = new Set<RiskCode>();
  const findings: RiskFinding[] = [];
  const addFinding = (code: RiskCode) => {
    if (codes.has(code)) return;
    codes.add(code);
    findings.push({ ...FINDINGS[code] });
  };

  let normalizedRecipient: `0x${string}` | undefined;
  if (!isAddress(input.recipient)) {
    addFinding("ADDRESS_INVALID");
  } else {
    normalizedRecipient = getAddress(input.recipient);
    if (normalizedRecipient === zeroAddress) addFinding("ADDRESS_ZERO");
    if (input.sender && isAddress(input.sender) && getAddress(input.sender) === normalizedRecipient) {
      addFinding("ADDRESS_SELF");
    }
    if (input.recipientHasCode) addFinding("ADDRESS_CONTRACT");
    if (input.recipientDenylisted) addFinding("ADDRESS_DENYLISTED");
  }

  let normalizedWebsite: string | undefined;
  const website = input.website?.trim();
  if (website) {
    try {
      const url = new URL(website);
      const hostname = url.hostname;
      normalizedWebsite = url.href;

      if (url.protocol !== "https:") addFinding("URL_NO_HTTPS");
      if (isIpHostname(hostname)) addFinding("URL_IP_HOST");
      if (url.username || url.password) addFinding("URL_CREDENTIALS");
      if (hostname.split(".").some((label) => label.toLowerCase().startsWith("xn--"))) {
        addFinding("URL_PUNYCODE");
      }
      if (hostname.split(".").filter(Boolean).length > 4) {
        addFinding("URL_MANY_SUBDOMAINS");
      }
      if (hostname.length > 80) addFinding("URL_LONG_HOST");
    } catch {
      addFinding("URL_INVALID");
    }
  }

  const level: RiskLevel = findings.some((finding) => finding.level === "high")
    ? "high"
    : findings.length > 0
      ? "warning"
      : "low";

  return {
    level,
    codes: [...codes],
    findings,
    ...(normalizedRecipient === undefined ? {} : { normalizedRecipient }),
    ...(normalizedWebsite === undefined ? {} : { normalizedWebsite }),
  };
}
