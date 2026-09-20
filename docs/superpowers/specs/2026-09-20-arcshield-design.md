# ArcShield Design

Date: 2026-09-20
Status: Approved for implementation planning

## Objective

Build a small, public Arc mainnet application that helps a user inspect payment risk before sending USDC. The project targets the Arc Microgrants program and must provide a live deployment, a public repository, a concise Arc-specific explanation, and a working mainnet transaction path.

ArcShield is a risk-indicator tool, not a guarantee that a recipient or website is safe.

## User Flow

1. The user connects an EIP-1193 browser wallet such as MetaMask.
2. ArcShield verifies that the wallet is on Arc mainnet, chain ID `5042`.
3. The user enters a recipient address, a USDC amount, and an optional website associated with the recipient.
4. ArcShield runs deterministic checks and displays a risk level plus specific reasons.
5. High-risk results block payment by default. The user may explicitly override the warning.
6. The user reviews the recipient, amount, network, risk result, and memo contents.
7. The wallet asks the user to sign the Arc transaction. ArcShield never receives the private key.
8. The completed transaction is linked to the Arc explorer and shown as the payment proof.

## Risk Checks

The first version uses transparent, local rules rather than an AI model or paid threat-intelligence API.

Address checks:

- Valid EVM address and checksum normalization.
- Reject the zero address.
- Warn when the recipient equals the connected wallet.
- Detect whether the recipient contains contract bytecode.
- Read Arc or USDC blocklist state when an official read method is available.

Website checks:

- Parse with the browser URL parser; do not use regular expressions as the parser.
- Warn on non-HTTPS URLs, IP-literal hosts, embedded credentials, punycode, excessive subdomains, and suspiciously long hosts.
- Hash the normalized URL before creating the onchain memo. Never publish the original URL onchain.

Each finding has a stable reason code, severity, and short explanation. The overall risk level is the highest triggered severity, not an opaque score.

## Arc Integration

- Network: Arc mainnet, chain ID `5042`.
- RPC: the official public Arc RPC for read operations.
- Asset: USDC. Arc uses USDC as its native gas asset and exposes an ERC-20 interface at `0x3600000000000000000000000000000000000000`.
- Receipt: prefer Arc's predeployed Memo and Multicall3From contracts so payment and receipt remain tied to the same user-approved operation without deploying a custom custody contract.
- Explorer: link successful transactions to `https://explorer.arc.io`.

If the official Memo interface cannot safely combine a payment and receipt for the required recipient type, the fallback is a direct wallet payment followed by a separate Memo receipt. The UI must label the two transactions clearly and never imply atomicity.

## Architecture

ArcShield is a static frontend application:

- React and TypeScript for the UI.
- Vite for local development and production builds.
- Viem for wallet connection, network validation, read calls, transaction simulation, and transaction submission.
- Pure TypeScript risk rules with no backend and no database.
- Static hosting for the live demo.

The project contains no server-held keys, user accounts, analytics, or persistent personal data.

## Security And Privacy

- Never request, store, log, or transmit a wallet seed phrase or private key.
- Never initiate a mainnet transaction without a visible review step and an explicit wallet signature.
- Simulate or estimate each transaction before asking the wallet to sign.
- Display the exact network, recipient, amount, and expected action in the confirmation view.
- Keep raw website URLs offchain; only a hash, risk level, and ruleset version may be included in a memo.
- Treat RPC, wallet, and explorer responses as untrusted external data and handle failures explicitly.
- Do not label a transaction or recipient as safe. Use `low indicators`, `warning`, and `high risk` language.

## Error Handling

The UI provides distinct recovery messages for:

- No compatible browser wallet.
- Wallet connection rejected.
- Wrong network or network-switch rejection.
- Invalid recipient or amount.
- Insufficient USDC for the payment and gas.
- RPC unavailable or stale.
- Transaction simulation failure.
- User rejection during signing.
- Transaction submission or confirmation failure.

No failed or rejected operation is reported as submitted.

## Interface

The first screen is the working payment-check flow, not a marketing landing page. It contains:

- Compact header with project name, Arc network status, and wallet control.
- Payment form for recipient, amount, and optional website.
- Risk-results area with severity, reason codes, and explanations.
- Review dialog showing the exact transaction details.
- Success state with the transaction hash and explorer link.

The design is responsive, keyboard-accessible, and usable without animation. High-risk warnings use both iconography and text, not color alone.

## Verification

- Unit tests cover each risk rule and the risk-level aggregation.
- Component tests cover invalid input, high-risk blocking, explicit override, and transaction error states.
- A production build must complete without TypeScript errors.
- A browser smoke test verifies the form and responsive layout without a wallet.
- Arc testnet validates wallet, RPC, memo, and payment behavior before mainnet use.
- A mainnet transaction and explorer record are required before the DoraHacks submission is described as complete.

## External Action Boundary

Development and testnet verification may proceed without real funds. Before any action that obtains, bridges, spends, or transfers real USDC, or deploys or submits a transaction on Arc mainnet, stop and ask the user to perform or explicitly approve that exact action.

## Out Of Scope

- PayPal integration.
- Custodial wallets or server-managed keys.
- AI classification models.
- Paid threat-intelligence APIs.
- User accounts, teams, dashboards, or admin panels.
- Cross-chain bridging inside ArcShield.
- Claims that ArcShield prevents fraud or guarantees safety.

## Submission Definition Of Done

- Public source repository under the user's GitHub account.
- Public static deployment that opens without authentication.
- Working MetaMask connection and Arc network detection.
- Deterministic address and website risk checks with explainable findings.
- Verified Arc mainnet transaction flow with an explorer link.
- DoraHacks BUIDL submission containing accurate links and no unverified claims.

## Sources

- Arc Microgrants: https://dorahacks.io/hackathon/arc-microgrants/detail
- Arc network configuration: https://docs.arc.io/arc/references/connect-to-arc
- Arc contract addresses: https://docs.arc.io/arc/references/contract-addresses
- Arc EVM differences: https://docs.arc.io/arc/references/evm-differences
