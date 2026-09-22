# DoraHacks Submission Draft

This file is a ready-to-edit field draft. Replace unchecked placeholders only with verified public evidence.

## Project name

ArcShield

## Tagline

Explainable risk indicators before an Arc USDC payment.

## Problem

A wallet confirmation shows transaction parameters but does not explain common warning signs in a recipient address or an associated payment URL. Users need a concise review step that makes deterministic checks visible before they decide whether to sign.

## Solution

ArcShield is a static React interface that checks an Arc recipient and optional website, displays stable reason codes and severity, and prepares a reviewed USDC payment. High-risk results require an explicit override. ArcShield provides indicators, not a fraud or safety guarantee.

## Arc usage

- Targets Arc Mainnet, chain ID `5042`.
- Reads recipient bytecode from the Arc RPC.
- Reads denylist status from the Arc USDC denylist contract.
- Encodes a 6-decimal USDC transfer to the reviewed recipient.
- Uses Arc's Memo contract to keep the transfer calldata and receipt metadata in one wallet-approved call.
- Stores the normalized website's Keccak-256 hash, risk level, reason codes, and ruleset version in Memo metadata; it does not store the raw URL onchain.
- Rechecks the wallet account and risk indicators, verifies an EOA sender and sufficient USDC balance, simulates the call, requests wallet confirmation, and waits for a successful receipt.

## Repository URL

- [ ] Add the verified public repository URL: `<PUBLIC_REPOSITORY_URL>`

## Live URL

- [ ] Add the verified public deployment URL: `<LIVE_DEMO_URL>`

## Arc mainnet transaction URL

- [ ] Complete an approved Arc mainnet payment and add its explorer URL: `<ARC_MAINNET_TRANSACTION_URL>`

## Screenshots

- [ ] Add a screenshot of the payment input and low/warning result: `<SCREENSHOT_URL_OR_FILE>`
- [ ] Add a screenshot showing a high-risk result and explicit override: `<SCREENSHOT_URL_OR_FILE>`
- [ ] Add a screenshot of the payment review dialog: `<SCREENSHOT_URL_OR_FILE>`
- [ ] Add a screenshot of verified transaction success and the Arc explorer record: `<SCREENSHOT_URL_OR_FILE>`

## Demo steps

1. Open the verified live URL or run `npm ci` and `npm run dev` locally.
2. Enter a recipient address, positive USDC amount with at most 6 decimal places, and an optional associated website.
3. Run the risk check and review the level, normalized recipient, and reason codes.
4. For a high result, acknowledge the warning explicitly before continuing.
5. Select **Review payment**, connect an injected browser wallet, and verify sender, recipient, amount, network, and risk indicators.
6. For a funded, approved demonstration, confirm in the wallet and open the successful transaction in the Arc explorer.

Do not perform step 6 with real funds until the exact transaction has been reviewed and approved.

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

- [x] `npm test` passes in the submission commit (3 files, 66 tests).
- [x] `npm run build` passes in the submission commit.
- [x] `git diff --check` passes before commit.
- [ ] Browser QA is completed against the final build.

External evidence:

- [ ] Public repository opens without authentication.
- [ ] Live deployment opens without authentication.
- [ ] Screenshots match the submitted build.
- [ ] Arc mainnet transaction is successful and opens in the Arc explorer.
- [ ] Repository URL, live URL, and transaction URL are copied into the DoraHacks fields.
- [ ] Final submission text contains no unverified production, award, traction, or safety claims.
