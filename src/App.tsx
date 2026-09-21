import { useState } from "react";
import { analyzePayment, type RiskReport } from "./core/risk";
import {
  ARC_EXPLORER_URL,
  buildMemoPayment,
  connectWallet,
  inspectRecipient,
  sendGuardedPayment,
  switchToArc,
} from "./lib/arc";

type FlowState =
  | { stage: "editing" }
  | { stage: "checking" }
  | { stage: "review"; report: RiskReport }
  | { stage: "submitting"; report: RiskReport }
  | { stage: "success"; report: RiskReport; hash: `0x${string}` }
  | { stage: "error"; message: string };

export default function App() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [website, setWebsite] = useState("");
  const [flow, setFlow] = useState<FlowState>({ stage: "editing" });
  const [account, setAccount] = useState<`0x${string}`>();
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const invalidateReport = () => {
    setFlow({ stage: "editing" });
    setReviewOpen(false);
    setRiskAccepted(false);
  };

  const runRiskCheck = async () => {
    setFlow({ stage: "checking" });
    setReviewOpen(false);
    setRiskAccepted(false);

    const localReport = analyzePayment({ recipient, website });
    if (!localReport.normalizedRecipient) {
      setFlow({ stage: "review", report: localReport });
      return;
    }

    try {
      const inspection = await inspectRecipient(localReport.normalizedRecipient);
      const report = analyzePayment({
        recipient,
        website,
        recipientHasCode: inspection.hasCode,
        recipientDenylisted: inspection.denylisted,
      });
      setFlow({ stage: "review", report });
    } catch (error) {
      setFlow({ stage: "error", message: errorMessage(error) });
    }
  };

  const openPaymentReview = async (report: RiskReport) => {
    setFlow({ stage: "checking" });
    try {
      const sender = account ?? (await connectWallet());
      setAccount(sender);
      const finalReport = analyzePayment({
        recipient,
        sender,
        website,
        recipientHasCode: report.codes.includes("ADDRESS_CONTRACT"),
        recipientDenylisted: report.codes.includes("ADDRESS_DENYLISTED"),
      });
      setFlow({ stage: "review", report: finalReport });
      if (finalReport.level === "high" && !riskAccepted) return;
      setReviewOpen(true);
    } catch (error) {
      setFlow({ stage: "error", message: errorMessage(error) });
    }
  };

  const confirmPayment = async (report: RiskReport) => {
    if (!account || !report.normalizedRecipient) return;
    setFlow({ stage: "submitting", report });
    try {
      await switchToArc();
      const payment = buildMemoPayment({
        account,
        recipient: report.normalizedRecipient,
        amount,
        report,
        operationId: `${Date.now()}`,
      });
      const { hash } = await sendGuardedPayment(payment);
      setReviewOpen(false);
      setFlow({ stage: "success", report, hash });
    } catch (error) {
      setReviewOpen(false);
      setFlow({ stage: "error", message: errorMessage(error) });
    }
  };

  const report =
    flow.stage === "review" || flow.stage === "submitting" || flow.stage === "success"
      ? flow.report
      : undefined;

  return (
    <>
      <header>
        <strong>ArcShield</strong>
        <span>Arc Mainnet (5042)</span>
      </header>

      <main>
        <h1>Check before you pay</h1>
        <form>
          <label>
            Recipient address
            <input
              name="recipient"
              autoComplete="off"
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                invalidateReport();
              }}
            />
          </label>

          <label>
            Amount in USDC
            <input
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                invalidateReport();
              }}
            />
          </label>

          <label>
            Associated website (optional)
            <input
              name="website"
              type="url"
              value={website}
              onChange={(event) => {
                setWebsite(event.target.value);
                invalidateReport();
              }}
            />
          </label>

          <button type="button" onClick={runRiskCheck} disabled={flow.stage === "checking"}>
            {flow.stage === "checking" ? "Checking..." : "Run risk check"}
          </button>
        </form>

        {report && (
          <section aria-label="Risk result">
            <h2>Risk result</h2>
            <p>Network: Arc Mainnet (5042)</p>
            <p>Recipient: {report.normalizedRecipient ?? recipient}</p>
            <p>Amount: {amount} USDC</p>
            <p>Risk level: {report.level}</p>
            <ul>
              {report.codes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <p>ArcShield provides risk indicators, not a safety guarantee.</p>

            {report.level === "high" && report.normalizedRecipient && (
              <label>
                <input
                  type="checkbox"
                  checked={riskAccepted}
                  onChange={(event) => setRiskAccepted(event.target.checked)}
                />
                I understand the risk
              </label>
            )}

            {report.normalizedRecipient && flow.stage === "review" && (
              <button
                type="button"
                disabled={report.level === "high" && !riskAccepted}
                onClick={() => openPaymentReview(report)}
              >
                Review payment
              </button>
            )}
          </section>
        )}

        {flow.stage === "error" && <p role="alert">{flow.message}</p>}

        {flow.stage === "success" && (
          <p>
            Payment confirmed.{" "}
            <a href={`${ARC_EXPLORER_URL}/tx/${flow.hash}`}>View transaction</a>
          </p>
        )}

        {reviewOpen && report && (
          <section role="dialog" aria-modal="true" aria-label="Payment review">
            <h2>Payment review</h2>
            <p>Network: Arc Mainnet (5042)</p>
            <p>Recipient: {report.normalizedRecipient}</p>
            <p>Amount: {amount} USDC</p>
            <p>Risk level: {report.level}</p>
            <p>Reason codes: {report.codes.length > 0 ? report.codes.join(", ") : "None"}</p>
            <p>ArcShield provides risk indicators, not a safety guarantee.</p>
            <button
              type="button"
              disabled={flow.stage === "submitting"}
              onClick={() => confirmPayment(report)}
            >
              {flow.stage === "submitting" ? "Submitting..." : "Confirm in wallet"}
            </button>
          </section>
        )}
      </main>
    </>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === 4001 || error.code === "USER_REJECTED") {
      return "You rejected the wallet request";
    }
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
