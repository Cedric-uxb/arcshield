# ArcShield

ArcShield is a pre-payment compliance evidence layer for Arc USDC transfers. It runs deterministic recipient and URL checks, explains every finding, requires explicit acknowledgement for high-risk payments, and prepares an Arc Memo call whose metadata omits the raw URL and records only its normalized URL hash plus public risk metadata for the reviewed decision.

Live demo: https://cedric-uxb.github.io/arcshield/

ArcShield reports deterministic indicators and stable reason codes. **It provides indicators, not a fraud or safety guarantee.** A low result only means that none of the implemented checks triggered.

## Judge demo

Open the live URL and verify that it contains the **Load low-indicator example** and **Load high-risk example** controls. If either control is missing, run the current branch locally with `npm ci` and `npm run dev`.

1. Select **Load low-indicator example**, then **Run risk check** to see a clean evidence summary.
2. Select **Load high-risk example**, then **Run risk check** to see explicit warning codes and the required **I understand the risk** acknowledgement.
3. Open **Review payment** only when using a compatible wallet; no wallet is required for steps 1-2.
4. Treat the explorer receipt as available only after a real confirmed Arc payment.

## Implemented checks

Address checks:

| Code | Level | Trigger |
| --- | --- | --- |
| `ADDRESS_INVALID` | High | Recipient is not a valid EVM address |
| `ADDRESS_ZERO` | High | Recipient is the zero address |
| `ADDRESS_SELF` | High | Connected sender and recipient are the same address |
| `ADDRESS_CONTRACT` | Warning | Arc returns bytecode for the recipient |
| `ADDRESS_DENYLISTED` | High | Arc's USDC denylist contract reports the recipient as denylisted |

Website checks:

| Code | Level | Trigger |
| --- | --- | --- |
| `URL_INVALID` | Warning | Browser URL parsing fails |
| `URL_NO_HTTPS` | Warning | Protocol is not HTTPS |
| `URL_IP_HOST` | Warning | Host is an IPv4 or bracketed IPv6 literal |
| `URL_CREDENTIALS` | Warning | URL embeds a username or password |
| `URL_PUNYCODE` | Warning | A hostname label starts with `xn--` |
| `URL_MANY_SUBDOMAINS` | Warning | Hostname has more than four non-empty labels |
| `URL_LONG_HOST` | Warning | Hostname is longer than 80 characters |

The overall level is `high` if any high finding is present, `warning` if any warning is present, and `low` otherwise. High-risk payments require an explicit user override before review.

## Arc architecture

ArcShield is a static React and TypeScript application built with Vite. Pure TypeScript performs the local rules, while Viem connects to an injected EIP-1193 browser wallet and Arc RPC. There is no application backend, database, account system, or server-held wallet key.

Current constants in `src/lib/arc.ts`:

| Item | Value |
| --- | --- |
| Network | Arc Mainnet |
| Chain ID | `5042` (`0x13b2`) |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| USDC contract | `0x3600000000000000000000000000000000000000` |
| USDC denylist contract | `0x3600000000000000000000000000000000000004` |
| Memo contract | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` |
| Ruleset | `arcshield-2026-09-21` |

The app reads recipient bytecode and denylist status from Arc. At confirmation it reconnects the wallet, verifies that the selected account and risk indicators have not changed, requests an Arc network switch, checks that the sender is an externally owned account (EOA), checks its USDC balance, simulates the Memo call, asks the wallet to sign, and waits for a successful receipt.

The Memo call targets USDC and wraps encoded `transfer(recipient, amount)` calldata. Memo metadata contains only:

- schema name `arcshield-payment-receipt`
- Keccak-256 hash of the normalized website, or the zero hash when omitted
- risk level and reason codes
- ruleset version

The raw website URL is not stored onchain. A URL hash is public metadata and may still be guessable when the original URL comes from a small or predictable set.

## Chainlink CRE workflow

`cre-workflow/` is a separate, read-only compliance orchestration path for the
Chainlink **Best workflow with CRE** bounty. An HTTP trigger accepts ArcShield's
local reason codes, reads the Arc mainnet USDC denylist contract, and queries
public RDAP registration data for the submitted hostname. It returns an
explainable `allow`, `review`, or `block` decision without moving funds or
writing onchain.

Only the hostname is sent to RDAP; the full payment URL is not sent. RDAP and
the local rules are evidence inputs, not proof that a domain or payment is safe.
See [`cre-workflow/README.md`](cre-workflow/README.md) for the exact simulation
command and evidence boundary.

## Local use

Prerequisite: a Node.js version accepted by `package.json` (`^22.22.2`, `^24.15.0`, or `>=26.0.0`).

```bash
npm ci
npm run dev
```

Vite prints the local URL. Run the automated checks with:

```bash
npm test
npm run build
```

## Wallet and security boundaries

- The browser wallet owns signing and key storage. ArcShield does not request, receive, store, or log a private key or seed phrase.
- Every payment has a visible review step and requires explicit confirmation in the wallet.
- Changing the connected account or recipient risk data forces a fresh review; a changed high-risk result also requires a fresh override.
- Payment amounts must be positive plain decimal USDC values with at most 6 fractional digits. Empty values, zero, negatives, exponent notation, and more than 6 decimals are rejected before wallet connection, and the transaction builder validates again with 6-decimal units.
- The sender must be an EOA. Contract accounts and smart contract wallets are rejected before simulation.
- Recipient checks and transaction simulation depend on the configured public Arc RPC. Network, wallet, simulation, submission, and receipt failures are surfaced instead of being reported as success.

## Limitations

- The checks are transparent heuristics, not fraud detection, recipient identity verification, or a safety guarantee.
- The browser payment flow has no reputation feed, threat-intelligence service, domain ownership check, content scan, DNS history, or certificate-age analysis. The optional CRE simulation adds public RDAP registration evidence only.
- A high-risk warning can be overridden by the user; ArcShield does not block the wallet itself.
- Only injected browser wallets using an EOA sender are supported. Smart contract wallets are not supported.
- The optional website is analyzed only as a URL string. ArcShield does not visit or validate the site.
- The app targets Arc mainnet, but this repository does not claim a completed mainnet transaction, production readiness, award, or user traction.
