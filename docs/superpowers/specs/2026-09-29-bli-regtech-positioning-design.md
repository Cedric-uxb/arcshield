# ArcShield BLI RegTech Positioning Design

Date: 2026-09-29
Status: Approved for specification review

## Objective

Improve ArcShield's chances in BLI Legal Tech Hackathon 2 by presenting the existing Arc payment flow as a credible USDC payment compliance evidence tool. The work must make the product easier to judge in under two minutes without inventing AI, safety, production, customer, or transaction claims.

This iteration targets the LegalTech and RegTech track. It does not pivot ArcShield into the unrelated Autonomous Agents bounty.

## Product Positioning

ArcShield is a pre-payment compliance evidence layer for Arc USDC transfers. It performs deterministic checks, explains every finding, requires explicit acknowledgement for high-risk payments, and places a privacy-preserving summary of the reviewed decision in Arc Memo metadata.

The interface must consistently distinguish:

- a risk indicator from a safety guarantee;
- a completed local check from an onchain transaction;
- a demo example from live wallet or network evidence;
- a public BUIDL profile from a BLI hackathon submission.

## User Experience

The first screen remains the working application, not a marketing landing page.

### Header

- Show the ArcShield name and a short compliance-oriented descriptor.
- Keep the Arc Mainnet status and wallet control visible.
- Use restrained styling that reads as a professional compliance tool.

### Review Workspace

- Keep recipient, USDC amount, optional website, and the risk-check action in the primary input area.
- Add two clearly labelled demo presets: a low-indicator example and a high-risk example.
- Presets only populate inputs. The normal risk engine still produces the result.
- Show a short three-step progress model: inspect, review, record.

### Evidence Panel

- Replace the visually empty initial result with an explanation of the checks that will run.
- After analysis, lead with the risk level and plain-language decision guidance.
- Group evidence into address, website, and onchain checks while preserving stable reason codes.
- Show ruleset version and the facts ArcShield can truthfully verify.
- Keep the existing high-risk acknowledgement and payment review behavior.

### Proof Strip

- Explain the evidence path: deterministic checks, wallet review, Arc Memo record, explorer receipt.
- Do not claim an explorer receipt exists until a real successful transaction is available.
- Keep supporting details compact so the working flow remains above the fold on desktop.

## Visual Direction

- Use an off-white application background, white work surfaces, charcoal text, green for verified or low-indicator states, amber for warnings, red for high risk, and a limited blue accent for Arc/network information.
- Avoid gradients, decorative blobs, oversized hero typography, nested cards, and promotional filler.
- Use Lucide icons already installed in the project.
- Keep cards at 8px radius or less and maintain clear keyboard focus states.
- Use stable grid tracks and responsive constraints so loading, results, and long addresses do not shift or overflow the layout.
- Collapse to one column on mobile while preserving the order: context, inputs, result, evidence path.

## Architecture And Data Flow

The existing React state machine, risk engine, Arc integration, and transaction flow remain authoritative.

1. A user enters data or selects a demo preset.
2. The existing `analyzePayment` and `inspectRecipient` flow produces the risk report.
3. The UI derives grouped evidence and explanatory copy from the existing report codes; it does not create a second risk engine.
4. The existing review dialog performs wallet connection, account checks, simulation, signing, and receipt handling.
5. Existing Arc Memo metadata remains the onchain evidence format.

No backend, database, analytics, AI model, threat-intelligence API, or new runtime dependency is added.

## Error Handling And Trust

- Preserve existing wallet, network, RPC, validation, simulation, rejection, replacement, cancellation, and receipt error states.
- Demo presets must be labelled examples and must not imply that an address is a real malicious actor.
- Error messages remain actionable and must never report a failed or cancelled operation as submitted.
- Color is supplemental; every risk and network state also uses text and iconography.
- Raw website URLs remain offchain; only the normalized hash may enter Memo metadata.

## Submission Materials

- Update README and submission copy to use the approved RegTech positioning.
- Capture matching desktop and mobile screenshots after the final build passes.
- Include a concise judging path that demonstrates low and high risk without requiring funds.
- Treat a successful Arc mainnet transaction and the final BLI attachment as separate external evidence tasks.
- Do not claim prize eligibility, traction, customers, production deployment, or a successful mainnet transaction without evidence.

## Verification

- Existing risk and transaction tests continue to pass.
- Add focused component tests for both demo presets and the evidence grouping they expose.
- Verify the production TypeScript/Vite build.
- Run browser checks at desktop and mobile viewports for overflow, text fit, focus behavior, and console errors.
- Verify that low, warning, high-risk, loading, wallet-error, review, pending, and success states remain usable.
- Confirm the public deployment matches the screenshots before updating the BUIDL materials.

## Definition Of Done

- The live interface communicates the RegTech value proposition in the first viewport.
- A judge can demonstrate low- and high-risk outcomes without connecting a wallet.
- Existing payment and Arc Memo behavior is unchanged except for presentation and demo input loading.
- The page is polished and responsive on desktop and mobile.
- Tests and production build pass.
- README and BUIDL draft accurately describe the implemented experience.
- Submission materials clearly separate implemented functionality, public deployment, mainnet evidence, and BLI submission status.

## Out Of Scope

- Autonomous trading or market-monitoring agents.
- Chainlink CRE integration.
- New smart contracts or custody logic.
- Backend accounts, dashboards, case management, or persistent audit storage.
- Paid APIs, reputation databases, or live website crawling.
- Real-fund transactions or irreversible external submissions without the required evidence and user-controlled wallet action.
