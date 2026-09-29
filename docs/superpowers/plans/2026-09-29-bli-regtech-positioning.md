# ArcShield BLI RegTech Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing ArcShield payment checker into a polished, judge-friendly Arc USDC compliance evidence experience without changing its security-sensitive transaction behavior.

**Architecture:** Keep the current `App.tsx` state machine, `core/risk.ts` rules, and `lib/arc.ts` transaction path authoritative. Add UI-only demo presets and derive evidence sections from the existing `RiskReport`; restyle the single-page workspace and update truthful submission materials without adding a backend or dependency.

**Tech Stack:** React 19, TypeScript, Vite, Viem, Lucide React, Vitest, Testing Library, CSS

---

## File Structure

- Modify `src/App.tsx`: add demo input presets, compliance-oriented content, evidence grouping, and proof-strip markup while preserving the existing flow state.
- Modify `src/styles.css`: implement the responsive compliance-workspace visual system and all existing state styles.
- Modify `src/App.test.tsx`: cover preset loading, evidence content, and the new first-viewport semantics.
- Modify `README.md`: describe the LegalTech/RegTech use case and judge demo path.
- Modify `SUBMISSION.md`: align the BUIDL draft with implemented evidence and preserve the truthful BLI submission checklist.
- Create `docs/images/arcshield-bli-desktop.png`: verified desktop screenshot of the completed interface.
- Create `docs/images/arcshield-bli-mobile.png`: verified mobile screenshot of the completed interface.

### Task 1: Add Honest Demo Presets

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing preset tests**

Add tests that prove presets populate fields without bypassing the existing check action:

```tsx
it("loads the low-indicator demo without running the check", async () => {
  render(<App />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Load low-indicator example" }));

  expect(screen.getByLabelText("Recipient address")).toHaveValue(
    "0x2222222222222222222222222222222222222222",
  );
  expect(screen.getByLabelText("Amount in USDC")).toHaveValue("25");
  expect(screen.getByLabelText("Associated website (optional)")).toHaveValue(
    "https://merchant.example",
  );
  expect(arc.inspectRecipient).not.toHaveBeenCalled();
  expect(screen.getByText("Not checked")).toBeInTheDocument();
  expect(screen.queryByText("ADDRESS_ZERO")).not.toBeInTheDocument();
});

it("loads and analyzes the high-risk demo through the normal risk engine", async () => {
  render(<App />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Load high-risk example" }));
  await user.click(screen.getByRole("button", { name: "Run risk check" }));

  const result = await screen.findByRole("region", { name: "Risk result" });
  expect(result).toHaveTextContent("ADDRESS_ZERO");
  expect(screen.getByRole("checkbox", { name: "I understand the risk" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --run src/App.test.tsx -t "demo"`

Expected: FAIL because the preset controls do not exist.

- [ ] **Step 3: Implement presets in the existing component**

Add immutable constants near `AMOUNT_ERROR`:

```tsx
const DEMO_PRESETS = {
  low: {
    recipient: "0x2222222222222222222222222222222222222222",
    amount: "25",
    website: "https://merchant.example",
  },
  high: {
    recipient: "0x0000000000000000000000000000000000000000",
    amount: "25",
    website: "http://198.51.100.42/login",
  },
} as const;
```

Add a loader that invalidates any stale report and only updates form state:

```tsx
const loadDemo = (preset: (typeof DEMO_PRESETS)[keyof typeof DEMO_PRESETS]) => {
  if (paymentLocked) return;
  requestVersion.current += 1;
  setRecipient(preset.recipient);
  setAmount(preset.amount);
  setWebsite(preset.website);
  setFlow({ stage: "editing" });
  setRiskAccepted(false);
};
```

Render two secondary buttons above the form fields with exact accessible names `Load low-indicator example` and `Load high-risk example`. Disable them whenever `paymentLocked` is true.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run src/App.test.tsx -t "demo"`

Expected: both demo tests PASS.

- [ ] **Step 5: Commit the preset behavior**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: add ArcShield judge demo presets"
```

### Task 2: Build the Compliance Evidence Experience

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing content and evidence tests**

Add tests for the first viewport and analyzed evidence:

```tsx
it("presents ArcShield as a payment compliance evidence tool", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: "Review the evidence before you pay" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Inspect")).toBeInTheDocument();
  expect(screen.getByText("Review")).toBeInTheDocument();
  expect(screen.getByText("Record")).toBeInTheDocument();
  expect(screen.getByText("Recipient bytecode")).toBeInTheDocument();
  expect(screen.getByText("USDC denylist status")).toBeInTheDocument();
  expect(screen.getByText("URL structure")).toBeInTheDocument();
});

it("groups analyzed findings and shows the active ruleset", async () => {
  arc.inspectRecipient.mockResolvedValue({ hasCode: true, denylisted: false });
  render(<App />);

  await enterPayment({ website: "http://example.com" });

  const result = await screen.findByRole("region", { name: "Risk result" });
  expect(within(result).getByText("Address evidence")).toBeInTheDocument();
  expect(within(result).getByText("Website evidence")).toBeInTheDocument();
  expect(within(result).getByText("Arc verification")).toBeInTheDocument();
  expect(within(result).getByText(RULESET_VERSION)).toBeInTheDocument();
  expect(within(result).getByText("ADDRESS_CONTRACT")).toBeInTheDocument();
  expect(within(result).getByText("URL_NO_HTTPS")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --run src/App.test.tsx -t "compliance|groups"`

Expected: FAIL because the compliance heading and grouped evidence do not exist.

- [ ] **Step 3: Add evidence derivation without duplicating risk logic**

Import `type RiskFinding` and add this pure helper below the state types:

```tsx
function groupFindings(findings: RiskFinding[]) {
  return {
    address: findings.filter(({ code }) => code.startsWith("ADDRESS_")),
    website: findings.filter(({ code }) => code.startsWith("URL_")),
  };
}
```

For a completed report, render three evidence groups:

```tsx
const evidence = payment ? groupFindings(payment.report.findings) : undefined;
```

```tsx
<div className="evidence-grid" aria-label="Compliance evidence">
  <EvidenceGroup title="Address evidence" findings={evidence.address} empty="No address warnings found." />
  <EvidenceGroup title="Website evidence" findings={evidence.website} empty="No website warnings found." />
  <section className="evidence-group">
    <h3>Arc verification</h3>
    <p>{payment.report.normalizedRecipient ? "Bytecode and USDC denylist reads completed." : "Onchain reads require a valid recipient."}</p>
    <span className="ruleset">Ruleset {RULESET_VERSION}</span>
  </section>
</div>
```

Keep `EvidenceGroup` in `App.tsx` because it is only used here:

```tsx
function EvidenceGroup({
  title,
  findings,
  empty,
}: {
  title: string;
  findings: RiskFinding[];
  empty: string;
}) {
  return (
    <section className="evidence-group">
      <h3>{title}</h3>
      {findings.length ? (
        <ul className="finding-list">
          {findings.map((finding) => (
            <li key={finding.code}>
              <code>{finding.code}</code>
              <span>{finding.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Replace generic framing with the approved product narrative**

Use the H1 `Review the evidence before you pay`, supporting copy `Explainable checks and an Arc-recorded decision trail for USDC payments.`, and a compact three-step list labelled `Inspect`, `Review`, and `Record`.

Replace the empty result body with three truthful check rows: `Recipient bytecode`, `USDC denylist status`, and `URL structure`. Add the proof strip after the workspace with four stages: deterministic checks, wallet review, Arc Memo record, and explorer receipt. Label the last stage `Available after a confirmed payment`.

- [ ] **Step 5: Run the component suite**

Run: `npm test -- --run src/App.test.tsx`

Expected: all `App` tests PASS, including existing wallet and payment-flow coverage.

- [ ] **Step 6: Commit the evidence experience**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: present payment compliance evidence"
```

### Task 3: Apply the Polished Responsive Visual System

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Establish the restrained color and spacing tokens**

Define reusable CSS custom properties in `:root` and keep the existing 8px maximum surface radius:

```css
:root {
  --ink: #17201c;
  --muted: #607069;
  --line: #d7ded9;
  --surface: #ffffff;
  --canvas: #f3f5f2;
  --green: #146c43;
  --amber: #8a5a00;
  --red: #a52d25;
  --blue: #245ea8;
  --radius: 8px;
}
```

Use these values for the header, controls, risk states, evidence groups, proof strip, and dialogs. Do not add gradients, decorative background shapes, or new font packages.

- [ ] **Step 2: Build a stable desktop workspace**

Set the main container to a maximum width of `76rem`, give the first-viewport intro compact spacing, and use a stable two-column layout:

```css
.workspace-grid {
  display: grid;
  grid-template-columns: minmax(19rem, 0.82fr) minmax(0, 1.18fr);
  align-items: start;
  gap: 1rem;
}

.evidence-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
```

Keep addresses and transaction hashes wrapping with `overflow-wrap: anywhere`. Give empty, loading, and result surfaces stable minimum dimensions so state changes do not resize the whole page.

- [ ] **Step 3: Make controls and proof stages scan quickly**

Style preset controls as compact secondary actions, risk levels with icon plus text, and the proof strip as an unframed horizontal section with numbered stages. Do not nest additional cards inside `.panel`; evidence groups use separators and subtle fills rather than another raised card layer.

- [ ] **Step 4: Add mobile behavior and motion preferences**

At `max-width: 760px`, collapse the workspace and evidence grid to one column, allow header controls to wrap, and keep every control at least `2.75rem` high. Preserve the order intro, form, result, proof strip. Keep `prefers-reduced-motion` support for the existing spinner.

- [ ] **Step 5: Run automated verification**

Run: `npm test && npm run build && git diff --check`

Expected: tests PASS, TypeScript/Vite build succeeds, and `git diff --check` prints no errors.

- [ ] **Step 6: Commit the visual system**

```bash
git add src/styles.css
git commit -m "style: polish ArcShield compliance workspace"
```

### Task 4: Align Public Project Materials

**Files:**
- Modify: `README.md`
- Modify: `SUBMISSION.md`

- [ ] **Step 1: Update README positioning and demo path**

Use this opening copy:

```markdown
# ArcShield

ArcShield is a pre-payment compliance evidence layer for Arc USDC transfers. It runs deterministic recipient and URL checks, explains every finding, requires explicit acknowledgement for high-risk payments, and prepares a privacy-preserving Arc Memo record for the reviewed decision.
```

Add a `Judge demo` section with these exact actions:

```markdown
## Judge demo

1. Select **Low-indicator example**, then run the risk check to see a clean evidence summary.
2. Select **High-risk example**, then run the check to see explicit warning codes and the required acknowledgement.
3. Open **Review payment** only when using a compatible wallet; no wallet is required for steps 1-2.
4. Treat the explorer receipt as available only after a real confirmed Arc payment.
```

- [ ] **Step 2: Update the BUIDL draft without overstating status**

Change the tagline to `Explainable compliance evidence before an Arc USDC payment.` Describe the proof path as deterministic check, human review, privacy-preserving Memo metadata, and explorer receipt after confirmation. Keep the BLI submission and mainnet transaction checklist items unchecked until independently verified.

- [ ] **Step 3: Verify public claims**

Run:

```bash
rg -n "guarantee|production|customer|traction|award|submitted|mainnet transaction" README.md SUBMISSION.md
```

Expected: every match is either a limitation, an explicit non-claim, or a still-unchecked evidence item.

- [ ] **Step 4: Commit project materials**

```bash
git add README.md SUBMISSION.md
git commit -m "docs: position ArcShield for BLI RegTech"
```

### Task 5: Browser QA And Submission Screenshots

**Files:**
- Create: `docs/images/arcshield-bli-desktop.png`
- Create: `docs/images/arcshield-bli-mobile.png`

- [ ] **Step 1: Start the production preview**

Run: `npm run build && npm run dev -- --host 127.0.0.1`

Expected: Vite reports a local URL and the page responds successfully.

- [ ] **Step 2: Verify desktop behavior at 1440x900**

Open the local URL, load and run both presets, and verify:

- the value proposition, input form, and evidence result are visible without incoherent overlap;
- the low example displays no warning codes after successful Arc reads;
- the high example displays `ADDRESS_ZERO`, `URL_NO_HTTPS`, and `URL_IP_HOST`;
- the high-risk acknowledgement controls `Review payment`;
- no horizontal page overflow or console errors appear.

Capture the high-risk state to `docs/images/arcshield-bli-desktop.png`.

- [ ] **Step 3: Verify mobile behavior at 390x844**

Repeat the high-risk flow and verify the layout order, text fit, button size, address wrapping, and absence of horizontal overflow. Capture the result to `docs/images/arcshield-bli-mobile.png`.

- [ ] **Step 4: Run final checks**

Run:

```bash
npm test
npm run build
git diff --check
git status --short
```

Expected: tests and build PASS, diff check is clean, and only the two intended screenshots remain uncommitted.

- [ ] **Step 5: Commit verified screenshots**

```bash
git add docs/images/arcshield-bli-desktop.png docs/images/arcshield-bli-mobile.png
git commit -m "docs: add ArcShield BLI demo screenshots"
```

### Task 6: Prepare External Release Evidence

**Files:**
- Modify: `SUBMISSION.md` only if live evidence changes

- [ ] **Step 1: Review the complete branch locally**

Run: `git log --oneline origin/main..HEAD && git status --short --branch`

Expected: the design, plan, implementation, documentation, and screenshot commits are present; no unrelated files are staged.

- [ ] **Step 2: Stop before publishing**

Do not push, deploy, submit the BUIDL, or send a real Arc transaction as part of local implementation. Present the verified branch status and request explicit approval for the external release actions.
