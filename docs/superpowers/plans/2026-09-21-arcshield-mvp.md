# ArcShield MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, static Arc payment guard that explains address and website risk, then lets a MetaMask user send USDC with an Arc Memo receipt.

**Architecture:** A React/Vite frontend contains a pure TypeScript risk engine and a small Viem adapter. The browser wallet signs every state-changing call; ArcShield stores no keys and uses Arc's predeployed Memo contract to atomically call USDC `transfer` with hashed risk metadata.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Viem 2, Vitest 5, Testing Library, jsdom, Lucide React.

---

## File Map

- `package.json`: scripts and pinned direct dependencies.
- `index.html`: Vite entry document.
- `tsconfig.json`: strict browser and test TypeScript settings.
- `vite.config.ts`: React plugin and Vitest jsdom configuration.
- `src/main.tsx`: React mount only.
- `src/App.tsx`: the single-screen scan, review, wallet, and result workflow.
- `src/styles.css`: responsive visual system and component states.
- `src/vite-env.d.ts`: Vite and injected-wallet types.
- `src/core/risk.ts`: pure deterministic address and URL checks.
- `src/core/risk.test.ts`: rule and aggregation tests.
- `src/lib/arc.ts`: Arc constants, read inspection, wallet session, memo payment encoding, simulation, and submission.
- `src/lib/arc.test.ts`: deterministic transaction encoding tests.
- `src/App.test.tsx`: user-flow component tests with a mocked Arc adapter.
- `src/test/setup.ts`: Testing Library cleanup and DOM matchers.
- `README.md`: truthful setup, limitations, security model, and demo instructions.
- `SUBMISSION.md`: DoraHacks field draft and evidence checklist.

### Task 1: Scaffold The Tested Frontend

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/vite-env.d.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/test/setup.ts`
- Create: `src/App.test.tsx`

- [ ] **Step 1: Add the package manifest**

Use these direct dependency versions, verified on 2026-09-21:

```json
{
  "name": "arcshield",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "lucide-react": "1.47.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "viem": "2.56.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "jsdom": "30.1.0",
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.1"
  }
}
```

- [ ] **Step 2: Add strict Vite and Vitest configuration**

`tsconfig.json` must enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `jsx: react-jsx`, and DOM/Vitest types. `vite.config.ts` must use `react()` and configure `test.environment = "jsdom"`, `setupFiles = ["./src/test/setup.ts"]`, and CSS loading.

- [ ] **Step 3: Write the initial failing render test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the working payment-check form", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Check before you pay" })).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient address")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in USDC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run risk check" })).toBeEnabled();
  });
});
```

- [ ] **Step 4: Verify RED**

Run: `npm install && npm test -- src/App.test.tsx`

Expected: FAIL because `src/App.tsx` does not yet export the required UI.

- [ ] **Step 5: Add the minimal app shell**

`App.tsx` must render a compact header, the three labeled fields `Recipient address`, `Amount in USDC`, and `Associated website (optional)`, and a `Run risk check` button. `main.tsx` mounts `<App />`; `index.html` contains `#root`; `styles.css` adds only the base page, form, and accessible focus styles needed for this test.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- src/App.test.tsx && npm run build`

Expected: one passing test and a successful Vite build.

```bash
git add package.json package-lock.json index.html tsconfig.json vite.config.ts src
git commit -m "feat: scaffold ArcShield frontend"
```

### Task 2: Implement Explainable Risk Rules

**Files:**
- Create: `src/core/risk.ts`
- Create: `src/core/risk.test.ts`

- [ ] **Step 1: Write failing table-driven tests**

Cover these exact cases:

```ts
expect(analyzePayment({ recipient: "bad" }).level).toBe("high");
expect(analyzePayment({ recipient: zeroAddress }).codes).toContain("ADDRESS_ZERO");
expect(analyzePayment({ recipient: account, sender: account }).codes).toContain("ADDRESS_SELF");
expect(analyzePayment({ recipient: account, website: "http://example.com" }).codes).toContain("URL_NO_HTTPS");
expect(analyzePayment({ recipient: account, website: "https://127.0.0.1/login" }).codes).toContain("URL_IP_HOST");
expect(analyzePayment({ recipient: account, website: "https://user:pass@example.com" }).codes).toContain("URL_CREDENTIALS");
expect(analyzePayment({ recipient: account, website: "https://xn--pple-43d.com" }).codes).toContain("URL_PUNYCODE");
expect(analyzePayment({ recipient: account, website: "https://pay.example.com" }).level).toBe("low");
```

Also verify that `ADDRESS_DENYLISTED` is high, `ADDRESS_CONTRACT` is warning, findings are deduplicated, and the highest severity wins.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/core/risk.test.ts`

Expected: FAIL because `analyzePayment` is missing.

- [ ] **Step 3: Implement the pure risk engine**

Export:

```ts
export type RiskLevel = "low" | "warning" | "high";
export type RiskCode =
  | "ADDRESS_INVALID" | "ADDRESS_ZERO" | "ADDRESS_SELF"
  | "ADDRESS_CONTRACT" | "ADDRESS_DENYLISTED"
  | "URL_INVALID" | "URL_NO_HTTPS" | "URL_IP_HOST"
  | "URL_CREDENTIALS" | "URL_PUNYCODE" | "URL_MANY_SUBDOMAINS"
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
```

Use Viem `getAddress`, `isAddress`, and `zeroAddress`; use the platform `URL` parser. An IPv4 or bracketed IPv6 host triggers `URL_IP_HOST`; more than four labels triggers `URL_MANY_SUBDOMAINS`; a hostname over 80 characters triggers `URL_LONG_HOST`. Do not add brand-name guessing or remote reputation claims.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/core/risk.test.ts`

Expected: all risk tests pass.

```bash
git add src/core/risk.ts src/core/risk.test.ts
git commit -m "feat: add explainable payment risk rules"
```

### Task 3: Encode Arc Reads And Memo Payments

**Files:**
- Create: `src/lib/arc.ts`
- Create: `src/lib/arc.test.ts`
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Write failing transaction-encoding tests**

With fixed inputs, assert that `buildMemoPayment`:

- uses Arc mainnet chain ID `5042`;
- targets Memo `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`;
- places USDC `0x3600000000000000000000000000000000000000` inside `memo(target, data, memoId, memoData)`;
- encodes `transfer(recipient, 1_250_000n)` for `1.25` USDC;
- includes only `schema`, `urlHash`, `riskLevel`, `reasonCodes`, and `ruleset` in decoded memo JSON;
- never includes the raw URL.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/arc.test.ts`

Expected: FAIL because the Arc adapter is missing.

- [ ] **Step 3: Add Arc constants and ABIs**

```ts
export const ARC_CHAIN_ID = 5042;
export const ARC_RPC_URL = "https://rpc.mainnet.arc.io";
export const ARC_EXPLORER_URL = "https://explorer.arc.io";
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const DENYLIST_ADDRESS = "0x3600000000000000000000000000000000000004" as const;
export const MEMO_ADDRESS = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const;
export const RULESET_VERSION = "arcshield-2026-09-21";
```

Define minimal ABIs only:

```ts
const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
]);
const denylistAbi = parseAbi(["function isDenylisted(address account) view returns (bool)"]);
const memoAbi = parseAbi([
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)"
]);
```

- [ ] **Step 4: Implement read inspection and deterministic encoding**

`inspectRecipient(address)` must run `getCode` and `isDenylisted` through a Viem public client and return `{ hasCode, denylisted }`. `hashWebsite(normalizedWebsite)` returns `keccak256(toBytes(normalizedWebsite))`, or the zero bytes32 value when no website is supplied.

`buildMemoPayment({ account, recipient, amount, report, operationId })` must:

1. Convert the amount with `parseUnits(amount, 6)` and reject values `<= 0`.
2. Encode `USDC.transfer(recipient, amountUnits)`.
3. Serialize a compact memo object that excludes the raw URL.
4. Build `memoId` from `keccak256(toBytes(operationId))`.
5. Return Viem `address`, `abi`, `functionName`, and `args` for the Memo call.

- [ ] **Step 5: Implement wallet submission without key custody**

Export `connectWallet`, `switchToArc`, and `sendGuardedPayment`. Use `window.ethereum`, Viem `custom`, and `requestAddresses`. `sendGuardedPayment` must call `publicClient.simulateContract` first, then `walletClient.writeContract`, then `waitForTransactionReceipt`. Return only after a successful receipt; map user rejection code `4001`, wrong network, insufficient funds, simulation failure, and RPC failure to distinct typed errors.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- src/lib/arc.test.ts && npm run build`

Expected: encoding tests pass and TypeScript accepts the wallet provider type.

```bash
git add src/lib src/vite-env.d.ts
git commit -m "feat: add Arc memo payment adapter"
```

### Task 4: Build The Scan And Review Workflow

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add failing component tests**

Mock `src/lib/arc.ts` and verify:

1. Invalid address produces `ADDRESS_INVALID` and no review button.
2. A contract recipient and HTTP website render both warning reasons.
3. A high-risk result disables `Review payment` until `I understand the risk` is checked.
4. The review dialog shows Arc mainnet, checksum recipient, amount, and reason codes.
5. A rejected wallet request shows `You rejected the wallet request` and no success link.
6. A confirmed receipt renders a link ending in `/tx/<hash>`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/App.test.tsx`

Expected: the new workflow tests fail against the shell.

- [ ] **Step 3: Implement one-screen application state**

Use a small state machine represented by a union:

```ts
type FlowState =
  | { stage: "editing" }
  | { stage: "checking" }
  | { stage: "review"; report: RiskReport }
  | { stage: "submitting"; report: RiskReport }
  | { stage: "success"; report: RiskReport; hash: `0x${string}` }
  | { stage: "error"; message: string };
```

Keep form values in controlled inputs. Running a check performs local analysis first; only a valid recipient triggers `inspectRecipient`, after which the final report is recomputed with `recipientHasCode` and `recipientDenylisted`. Connecting the wallet is optional for scanning and required only before payment review.

- [ ] **Step 4: Implement the explicit review and override**

The review surface must show network `Arc Mainnet (5042)`, recipient, amount, risk level, each reason code, and a statement that ArcShield provides indicators rather than a safety guarantee. High-risk reports require an unchecked-by-default override checkbox. The final command button text is `Confirm in wallet`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/App.test.tsx`

Expected: all component tests pass.

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: add scan and payment review flow"
```

### Task 5: Finish Responsive Product Styling

**Files:**
- Modify: `src/styles.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Apply the final visual system**

Use a restrained neutral surface with green for verified network state, amber for warnings, and red for high risk. Use Lucide icons for wallet, shield, external link, warning, and success actions. Keep cards at `8px` radius or less, avoid gradients and decorative blobs, and preserve visible focus rings.

The desktop layout uses a constrained two-column grid for form and results; below `760px` it becomes one column. Set stable button/input heights, allow long addresses to wrap, and ensure dialogs fit within `100dvh` with internal scrolling.

- [ ] **Step 2: Add accessible status semantics**

Risk results use `aria-live="polite"`; transaction errors use `role="alert"`; the review dialog has `role="dialog"`, `aria-modal="true"`, a labeled heading, Escape handling, initial focus, and focus return.

- [ ] **Step 3: Verify and commit**

Run: `npm test && npm run build`

Expected: all tests pass and the production build succeeds.

```bash
git add src/App.tsx src/styles.css
git commit -m "feat: polish responsive ArcShield interface"
```

### Task 6: Document Truthful Setup And Submission Evidence

**Files:**
- Create: `README.md`
- Create: `SUBMISSION.md`
- Create: `.gitignore`

- [ ] **Step 1: Add repository hygiene**

`.gitignore` must include `node_modules/`, `dist/`, `.env*`, coverage output, logs, and macOS metadata. Include `!.env.example` even though the MVP needs no secret.

- [ ] **Step 2: Write the README**

Document the problem, exact risk checks, Arc-specific architecture, Memo and USDC addresses, local commands, test commands, security boundaries, and limitations. State that no raw URL is stored onchain and that ArcShield is not a fraud guarantee. Do not claim a mainnet transaction until one exists.

- [ ] **Step 3: Write the DoraHacks draft**

`SUBMISSION.md` must contain draft fields for project name, tagline, problem, solution, Arc usage, repository URL, live URL, mainnet transaction URL, screenshots, and demo steps. Unknown external URLs remain as unchecked checklist items rather than invented values.

- [ ] **Step 4: Verify and commit**

Run: `rg -n 'private key|seed phrase|guarantee|mainnet' README.md SUBMISSION.md`

Expected: only warning/boundary language and unchecked mainnet evidence remain.

```bash
git add .gitignore README.md SUBMISSION.md
git commit -m "docs: add ArcShield setup and submission checklist"
```

### Task 7: Local Browser QA

**Files:**
- Modify only files required by observed failures.

- [ ] **Step 1: Run the complete automated verification**

Run: `npm test && npm run build`

Expected: zero failed tests and a successful production build.

- [ ] **Step 2: Start the development server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite prints a local URL and keeps running.

- [ ] **Step 3: Verify desktop and mobile in a real browser**

Use Playwright at `1440x900` and `390x844`. Capture screenshots after a low-risk scan and a high-risk scan. Confirm no blank areas, overlap, clipped addresses, accidental horizontal scroll, or inaccessible controls. Use a mocked provider for UI-only wallet states; do not request a real signature.

- [ ] **Step 4: Fix only observed defects and re-run checks**

After each correction run `npm test && npm run build`, then repeat the failed viewport.

- [ ] **Step 5: Commit verified local MVP**

```bash
git add src README.md SUBMISSION.md
git commit -m "fix: resolve ArcShield QA findings"
```

Skip this commit when QA requires no file changes.

### Task 8: Testnet, Publishing, And Mainnet Gates

**Files:**
- Modify: `SUBMISSION.md` only after evidence exists.

- [ ] **Step 1: Test with Arc Testnet configuration locally**

Temporarily inject testnet chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`, and denylist `0x360b451bb0490637F52fa1794961455615777757` through an uncommitted local configuration. Obtain faucet USDC manually. Verify connection, denied signing, a successful tiny test transfer, Memo event, and explorer link. Revert only the uncommitted testnet configuration after recording evidence; never commit a private key or seed phrase.

- [ ] **Step 2: Stop for external publishing approval**

Show the final diff, test results, intended GitHub repository name, and intended hosting target. Obtain explicit user approval before creating the remote repository, pushing, or publishing the site.

- [ ] **Step 3: Publish and verify**

After approval, create the public repository, push `main`, deploy the static build, and open both public URLs in a clean browser session. Record only verified URLs in `SUBMISSION.md`.

- [ ] **Step 4: Stop for real-USDC approval**

Show the exact wallet address, network `Arc Mainnet (5042)`, proposed recipient, transfer amount, estimated fee, and operation purpose. The user must explicitly approve and sign the wallet request. Codex must never enter a seed phrase, private key, password, OTP, or recovery code.

- [ ] **Step 5: Verify mainnet evidence and prepare DoraHacks draft**

After a successful receipt, open the explorer transaction, verify status, sender, recipient, amount, USDC transfer, and Memo event. Add the verified explorer URL to `SUBMISSION.md`, commit the evidence update, and present the exact DoraHacks submission fields for user review before external submission.

## Final Verification Checklist

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Desktop and mobile browser screenshots are clean.
- [ ] No raw URL appears in memo encoding or tests.
- [ ] No secrets, private keys, wallet addresses, or personal data are committed.
- [ ] The public repo and live site are opened and verified after approval.
- [ ] Arc mainnet evidence is claimed only after an explorer-confirmed transaction.
- [ ] DoraHacks is submitted only with real, verified links.
