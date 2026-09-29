# DoraHacks Submission Draft

This file is a ready-to-edit field draft. Replace unchecked placeholders only with verified public evidence.

## Project name

ArcShield

## Tagline

Explainable compliance evidence before an Arc USDC payment.

## Problem

An Arc USDC payment can reach wallet confirmation without a concise evidence trail explaining common warning signs in the recipient address or associated payment URL. BLI LegalTech/RegTech reviewers need a transparent pre-payment compliance step that shows what was checked, what a human reviewed, and what was acknowledged before signing.

## Solution

ArcShield implements that proof path in a static React interface: deterministic recipient and URL checks produce stable reason codes, a human reviews the evidence, and high-risk payments require explicit acknowledgement. If the user proceeds, ArcShield prepares a wallet-approved Arc Memo call with privacy-preserving metadata containing the normalized URL hash, risk level, reason codes, and ruleset version rather than the raw URL. An explorer receipt is available only after the user confirms the payment and Arc confirms the transaction. This auditable, human-in-the-loop evidence flow is the project's BLI LegalTech/RegTech fit. ArcShield provides indicators, not a fraud or safety guarantee.

## Arc usage

- Targets Arc Mainnet, chain ID `5042`.
- Reads recipient bytecode from the Arc RPC.
- Reads denylist status from the Arc USDC denylist contract.
- Encodes a 6-decimal USDC transfer to the reviewed recipient.
- Uses Arc's Memo contract to keep the transfer calldata and receipt metadata in one wallet-approved call.
- Stores the normalized website's Keccak-256 hash, risk level, reason codes, and ruleset version in Memo metadata; it does not store the raw URL onchain.
- Rechecks the wallet account and risk indicators, verifies an EOA sender and sufficient USDC balance, simulates the call, requests wallet confirmation, and waits for a successful receipt.

## Repository URL

- [x] https://github.com/Cedric-uxb/arcshield

## Live URL

- [x] https://cedric-uxb.github.io/arcshield/

## DoraHacks BUIDL

- [x] Public BUIDL profile: https://dorahacks.io/buidl/49122
- [ ] Submit the existing ArcShield BUIDL to BLI Legal Tech Hackathon 2. The event page still shows `Submit BUIDL`, and ArcShield is not in the event's submitted BUIDL list.

## Arc mainnet transaction URL

- [ ] Complete an approved Arc mainnet payment and add its explorer URL: `<ARC_MAINNET_TRANSACTION_URL>`

## Screenshots

- [ ] Add a screenshot of the payment input and low/warning result: `<SCREENSHOT_URL_OR_FILE>`
- [ ] Add a screenshot showing a high-risk result and explicit override: `<SCREENSHOT_URL_OR_FILE>`
- [ ] Add a screenshot of the payment review dialog: `<SCREENSHOT_URL_OR_FILE>`
- [ ] Add a screenshot of verified transaction success and the Arc explorer record: `<SCREENSHOT_URL_OR_FILE>`

## Demo steps

1. Open the live URL and verify that it contains the **Load low-indicator example** and **Load high-risk example** controls. If either control is missing, run the current branch locally with `npm ci` and `npm run dev`.
2. Select **Load low-indicator example**, then **Run risk check** to review the clean evidence summary.
3. Select **Load high-risk example**, then **Run risk check** to review the explicit warning codes and required **I understand the risk** acknowledgement. No wallet is required for steps 2-3.
4. Select **Review payment** only with a compatible injected browser wallet, then verify the sender, recipient, amount, network, and risk indicators.
5. For a funded, approved demonstration, confirm the payment in the wallet. Treat the explorer receipt as available only after Arc confirms the transaction.

Do not perform step 5 with real funds until the exact transaction has been reviewed and approved.

## Tech stack

- React 19 and TypeScript
- Vite
- Viem
- Vitest, Testing Library, and jsdom
- Arc Mainnet public RPC, USDC, USDC denylist, Memo, and explorer

## Limitations

- Deterministic indicators only; no fraud guarantee, identity verification, reputation data, threat-intelligence feed, or website content scan.
- The optional URL is parsed locally and not visited. Only its normalized hash is included in Memo metadata, and predictable URLs may still be guessable from a public hash.
- EOA senders only; smart contract wallets are rejected before simulation.
- Requires an injected EIP-1193 browser wallet and the configured Arc RPC.
- High-risk results can be overridden after explicit acknowledgement.
- Current evidence is limited to local automated tests and a local production build until the external checklist below is completed.

## Evidence checklist

Local verification:

- [x] `npm test` passes at the recorded submission commit.
- [x] `npm run build` passes in the submission commit.
- [x] `git diff --check` passes before commit.
- [x] Browser QA completed locally at `1440x900` and `390x844`; low- and high-risk results rendered without overlap or horizontal overflow, and the browser console remained clear.

External evidence:

- [x] Public repository opens without authentication.
- [x] Live deployment opens without authentication.
- [ ] Screenshots match the submitted build.
- [ ] Arc mainnet transaction is successful and opens in the Arc explorer.
- [x] Repository URL, live URL, and the Arc Memo contract address are saved in the ArcShield BUIDL profile.
- [ ] ArcShield is attached and submitted to BLI Legal Tech Hackathon 2.
- [x] Final submission text contains no unverified production, award, traction, or safety claims.
