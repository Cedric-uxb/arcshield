import { useEffect, useRef, useState, type FormEvent } from "react";
import { analyzePayment, type RiskReport } from "./core/risk";
import {
  ARC_EXPLORER_URL,
  buildMemoPayment,
  connectWallet,
  inspectRecipient,
  sendGuardedPayment,
  switchToArc,
} from "./lib/arc";

interface PaymentSnapshot {
  recipient: string;
  amount: string;
  website: string;
  report: RiskReport;
}

interface ReviewedPayment extends Omit<PaymentSnapshot, "recipient"> {
  recipient: `0x${string}`;
  account: `0x${string}`;
}

type FlowState =
  | { stage: "editing" }
  | { stage: "checking" }
  | { stage: "review"; dialog: "closed"; payment: PaymentSnapshot; message?: string }
  | { stage: "review"; dialog: "open"; payment: ReviewedPayment }
  | { stage: "submitting"; payment: ReviewedPayment }
  | { stage: "success"; payment: ReviewedPayment; hash: `0x${string}` }
  | { stage: "error"; message: string };

const AMOUNT_ERROR = "Enter a positive USDC amount with up to 6 decimal places";

export default function App() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [website, setWebsite] = useState("");
  const [flow, setFlow] = useState<FlowState>({ stage: "editing" });
  const [riskAccepted, setRiskAccepted] = useState(false);
  const requestVersion = useRef(0);
  const reviewButton = useRef<HTMLButtonElement>(null);

  const submitting = flow.stage === "submitting";
  const reviewOpen = flow.stage === "review" && flow.dialog === "open";
  const modalOpen = reviewOpen || submitting;
  const payment =
    flow.stage === "review" || flow.stage === "submitting" || flow.stage === "success"
      ? flow.payment
      : undefined;

  const invalidateReport = () => {
    if (modalOpen) return;
    requestVersion.current += 1;
    setFlow({ stage: "editing" });
    setRiskAccepted(false);
  };

  const runRiskCheck = async () => {
    const requestId = ++requestVersion.current;
    const input = { recipient, amount: amount.trim(), website: website.trim() };
    setFlow({ stage: "checking" });
    setRiskAccepted(false);

    const localReport = analyzePayment({
      recipient: input.recipient,
      website: input.website,
    });
    if (!localReport.normalizedRecipient) {
      if (requestId === requestVersion.current) {
        setFlow({
          stage: "review",
          dialog: "closed",
          payment: { ...input, report: localReport },
        });
      }
      return;
    }

    try {
      const inspection = await inspectRecipient(localReport.normalizedRecipient);
      if (requestId !== requestVersion.current) return;
      const report = analyzePayment({
        recipient: input.recipient,
        website: input.website,
        recipientHasCode: inspection.hasCode,
        recipientDenylisted: inspection.denylisted,
      });
      setFlow({
        stage: "review",
        dialog: "closed",
        payment: {
          ...input,
          recipient: report.normalizedRecipient ?? input.recipient,
          report,
        },
      });
    } catch (error) {
      if (requestId === requestVersion.current) {
        setFlow({ stage: "error", message: errorMessage(error) });
      }
    }
  };

  const submitRiskCheck = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (flow.stage !== "checking" && !modalOpen) void runRiskCheck();
  };

  const openPaymentReview = async (scanned: PaymentSnapshot) => {
    if (!isValidAmount(scanned.amount)) {
      setFlow({ stage: "error", message: AMOUNT_ERROR });
      return;
    }
    const normalizedRecipient = scanned.report.normalizedRecipient;
    if (!normalizedRecipient) return;

    const requestId = ++requestVersion.current;
    setFlow({ stage: "checking" });
    try {
      const account = await connectWallet();
      if (requestId !== requestVersion.current) return;
      const report = analyzePayment({
        recipient: scanned.recipient,
        sender: account,
        website: scanned.website,
        recipientHasCode: scanned.report.codes.includes("ADDRESS_CONTRACT"),
        recipientDenylisted: scanned.report.codes.includes("ADDRESS_DENYLISTED"),
      });
      const reviewed: ReviewedPayment = {
        ...scanned,
        recipient: report.normalizedRecipient ?? normalizedRecipient,
        account,
        report,
      };
      if (report.level === "high" && !riskAccepted) {
        setFlow({ stage: "review", dialog: "closed", payment: reviewed });
        return;
      }
      setFlow({ stage: "review", dialog: "open", payment: reviewed });
    } catch (error) {
      if (requestId === requestVersion.current) {
        setFlow({ stage: "error", message: errorMessage(error) });
      }
    }
  };

  const returnToReview = (reviewed: ReviewedPayment, message?: string) => {
    setFlow({
      stage: "review",
      dialog: "closed",
      payment: paymentSnapshot(reviewed),
      ...(message ? { message } : {}),
    });
    window.setTimeout(() => reviewButton.current?.focus(), 0);
  };

  useEffect(() => {
    if (flow.stage !== "review" || flow.dialog !== "open") return;
    const reviewed = flow.payment;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      returnToReview(reviewed);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [flow]);

  const confirmPayment = async (reviewed: ReviewedPayment) => {
    setFlow({ stage: "submitting", payment: reviewed });
    try {
      const account = await connectWallet();
      if (account.toLowerCase() !== reviewed.account.toLowerCase()) {
        setRiskAccepted(false);
        returnToReview(reviewed, "Wallet account changed. Review the payment again.");
        return;
      }

      const inspection = await inspectRecipient(reviewed.recipient);
      const report = analyzePayment({
        recipient: reviewed.recipient,
        sender: account,
        website: reviewed.website,
        recipientHasCode: inspection.hasCode,
        recipientDenylisted: inspection.denylisted,
      });
      const revalidated = { ...reviewed, account, report };
      if (riskReportChanged(reviewed.report, report)) {
        setRiskAccepted(false);
        returnToReview(revalidated, "Risk indicators changed. Review the payment again.");
        return;
      }

      setFlow({ stage: "submitting", payment: revalidated });
      await switchToArc();
      const paymentRequest = buildMemoPayment({
        account: revalidated.account,
        recipient: revalidated.recipient,
        amount: revalidated.amount,
        report: revalidated.report,
        operationId: `${Date.now()}`,
      });
      const { hash } = await sendGuardedPayment(paymentRequest);
      setFlow({ stage: "success", payment: revalidated, hash });
    } catch (error) {
      setFlow({ stage: "error", message: errorMessage(error) });
    }
  };

  return (
    <>
      <header>
        <strong>ArcShield</strong>
        <span>Arc Mainnet (5042)</span>
      </header>

      <main>
        <h1>Check before you pay</h1>
        <form noValidate onSubmit={submitRiskCheck}>
          <label>
            Recipient address
            <input
              name="recipient"
              autoComplete="off"
              value={recipient}
              disabled={modalOpen}
              onChange={(event) => {
                if (modalOpen) return;
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
              disabled={modalOpen}
              onChange={(event) => {
                if (modalOpen) return;
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
              disabled={modalOpen}
              onChange={(event) => {
                if (modalOpen) return;
                setWebsite(event.target.value);
                invalidateReport();
              }}
            />
          </label>

          <button
            type="submit"
            disabled={flow.stage === "checking" || modalOpen}
          >
            {flow.stage === "checking" ? "Checking..." : "Run risk check"}
          </button>
        </form>

        {payment && (
          <section aria-label="Risk result">
            <h2>Risk result</h2>
            <p>Network: Arc Mainnet (5042)</p>
            <p>Recipient: {payment.report.normalizedRecipient ?? payment.recipient}</p>
            <p>Amount: {payment.amount} USDC</p>
            <p>Risk level: {payment.report.level}</p>
            <ul>
              {payment.report.codes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <p>ArcShield provides risk indicators, not a safety guarantee.</p>

            {payment.report.level === "high" &&
              payment.report.normalizedRecipient &&
              flow.stage === "review" &&
              flow.dialog === "closed" && (
                <label>
                  <input
                    type="checkbox"
                    checked={riskAccepted}
                    onChange={(event) => setRiskAccepted(event.target.checked)}
                  />
                  I understand the risk
                </label>
              )}

            {payment.report.normalizedRecipient &&
              flow.stage === "review" &&
              flow.dialog === "closed" && (
                <button
                  ref={reviewButton}
                  type="button"
                  disabled={payment.report.level === "high" && !riskAccepted}
                  onClick={() => openPaymentReview(payment)}
                >
                  Review payment
                </button>
              )}
          </section>
        )}

        {flow.stage === "error" && <p role="alert">{flow.message}</p>}

        {flow.stage === "review" && flow.dialog === "closed" && flow.message && (
          <p role="alert">{flow.message}</p>
        )}

        {flow.stage === "success" && (
          <p>
            Payment confirmed.{" "}
            <a href={`${ARC_EXPLORER_URL}/tx/${flow.hash}`}>View transaction</a>
          </p>
        )}

        {flow.stage === "review" && flow.dialog === "open" && (
          <PaymentDialog
            payment={flow.payment}
            submitting={false}
            onCancel={() => returnToReview(flow.payment)}
            onConfirm={() => confirmPayment(flow.payment)}
          />
        )}

        {flow.stage === "submitting" && (
          <PaymentDialog payment={flow.payment} submitting />
        )}
      </main>
    </>
  );
}

function PaymentDialog({
  payment,
  submitting,
  onCancel,
  onConfirm,
}: {
  payment: ReviewedPayment;
  submitting: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  return (
    <section role="dialog" aria-modal="true" aria-label="Payment review">
      <h2>Payment review</h2>
      <p>Network: Arc Mainnet (5042)</p>
      <p>Sender: {payment.account}</p>
      <p>Recipient: {payment.recipient}</p>
      <p>Amount: {payment.amount} USDC</p>
      <p>Risk level: {payment.report.level}</p>
      <p>
        Reason codes: {payment.report.codes.length > 0 ? payment.report.codes.join(", ") : "None"}
      </p>
      <p>ArcShield provides risk indicators, not a safety guarantee.</p>
      <button type="button" autoFocus disabled={submitting} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" disabled={submitting} onClick={onConfirm}>
        Confirm in wallet
      </button>
      {submitting && <p role="status">Submitting payment...</p>}
    </section>
  );
}

function paymentSnapshot(payment: ReviewedPayment): PaymentSnapshot {
  return {
    recipient: payment.recipient,
    amount: payment.amount,
    website: payment.website,
    report: payment.report,
  };
}

function riskReportChanged(previous: RiskReport, current: RiskReport): boolean {
  return previous.level !== current.level || previous.codes.join("|") !== current.codes.join("|");
}

function isValidAmount(value: string): boolean {
  const amount = value.trim();
  return /^\d+(?:\.\d{1,6})?$/.test(amount) && /[1-9]/.test(amount);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code === "USER_REJECTED") {
    return "You rejected the wallet request";
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
