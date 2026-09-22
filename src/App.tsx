import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CircleCheck,
  ExternalLink,
  LoaderCircle,
  Search,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { analyzePayment, type RiskReport } from "./core/risk";
import {
  ARC_EXPLORER_URL,
  ArcShieldError,
  MEMO_ADDRESS,
  RULESET_VERSION,
  buildMemoPayment,
  connectWallet,
  hashWebsite,
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
  | { stage: "pending"; payment: ReviewedPayment; hash: `0x${string}` }
  | { stage: "error"; message: string };

const AMOUNT_ERROR = "Enter a positive USDC amount with up to 6 decimal places";

export default function App() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [website, setWebsite] = useState("");
  const [flow, setFlow] = useState<FlowState>({ stage: "editing" });
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [walletAccount, setWalletAccount] = useState<`0x${string}`>();
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");
  const requestVersion = useRef(0);
  const reviewButton = useRef<HTMLButtonElement>(null);

  const submitting = flow.stage === "submitting";
  const reviewOpen = flow.stage === "review" && flow.dialog === "open";
  const modalOpen = reviewOpen || submitting;
  const paymentLocked = modalOpen || flow.stage === "pending";
  const payment =
    flow.stage === "review" ||
    flow.stage === "submitting" ||
    flow.stage === "success" ||
    flow.stage === "pending"
      ? flow.payment
      : undefined;

  const invalidateReport = () => {
    if (paymentLocked) return;
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
    if (flow.stage !== "checking" && !paymentLocked) void runRiskCheck();
  };

  const connectHeaderWallet = async () => {
    setWalletConnecting(true);
    setWalletError("");
    try {
      setWalletAccount(await connectWallet());
    } catch (error) {
      setWalletError(errorMessage(error));
    } finally {
      setWalletConnecting(false);
    }
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
      setWalletAccount(account);
      setWalletError("");
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
      setWalletAccount(account);
      setWalletError("");
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
      const hash = unknownTransactionHash(error);
      if (hash) {
        setFlow({ stage: "pending", payment: reviewed, hash });
        return;
      }
      setFlow({ stage: "error", message: errorMessage(error) });
    }
  };

  const RiskIcon = payment?.report.level === "low" ? CircleCheck : TriangleAlert;

  return (
    <>
      <div className="app-content" inert={modalOpen ? true : undefined}>
        <header className="app-header">
          <div className="brand">
            <ShieldCheck aria-hidden="true" size={22} />
            <strong>ArcShield</strong>
          </div>
          <div className="header-controls">
            <span className="network-status">
              <span className="network-label">Target network</span>
              <span>Arc Mainnet (5042)</span>
            </span>
            <button
              className="wallet-button"
              type="button"
              disabled={walletConnecting}
              aria-label={walletAccount ? `Connected wallet ${walletAccount}` : "Connect wallet"}
              onClick={() => void connectHeaderWallet()}
            >
              {walletConnecting ? (
                <LoaderCircle className="spinner" aria-hidden="true" size={16} />
              ) : (
                <Wallet aria-hidden="true" size={16} />
              )}
              {walletConnecting
                ? "Connecting..."
                : walletAccount
                  ? shortenAddress(walletAccount)
                  : "Connect wallet"}
            </button>
            {walletError && (
              <p className="wallet-error" role="alert">
                {walletError}
              </p>
            )}
          </div>
        </header>

        <main className="app-shell">
        <div className="page-heading">
          <h1>Check before you pay</h1>
        </div>

        <div className="workspace-grid">
          <section className="panel form-panel" aria-labelledby="payment-details-title">
            <div className="panel-heading">
              <span className="icon-box neutral">
                <Wallet aria-hidden="true" size={20} />
              </span>
              <h2 id="payment-details-title">Payment details</h2>
            </div>

            <form noValidate onSubmit={submitRiskCheck}>
              <label>
                Recipient address
                <input
                  name="recipient"
                  autoComplete="off"
                  value={recipient}
                  disabled={paymentLocked}
                  onChange={(event) => {
                    if (paymentLocked) return;
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
                  disabled={paymentLocked}
                  onChange={(event) => {
                    if (paymentLocked) return;
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
                  disabled={paymentLocked}
                  onChange={(event) => {
                    if (paymentLocked) return;
                    setWebsite(event.target.value);
                    invalidateReport();
                  }}
                />
              </label>

              <button
                className="primary-button"
                type="submit"
                disabled={flow.stage === "checking" || paymentLocked}
              >
                {flow.stage === "checking" ? (
                  <LoaderCircle className="spinner" aria-hidden="true" size={18} />
                ) : (
                  <Search aria-hidden="true" size={18} />
                )}
                {flow.stage === "checking" ? "Checking..." : "Run risk check"}
              </button>
            </form>
          </section>

          <div className="result-column">
            {payment ? (
              <section
                className={`panel risk-panel risk-${payment.report.level}`}
                aria-label="Risk result"
                aria-live="polite"
                aria-atomic="true"
              >
                <div className="risk-heading">
                  <span className="icon-box">
                    <RiskIcon aria-hidden="true" size={20} />
                  </span>
                  <div>
                    <h2>Risk result</h2>
                    <span className="risk-badge">{payment.report.level}</span>
                  </div>
                </div>

                <dl className="detail-list">
                  <div>
                    <dt>Network</dt>
                    <dd>Arc Mainnet (5042)</dd>
                  </div>
                  <div>
                    <dt>Recipient</dt>
                    <dd className="code-value">
                      {payment.report.normalizedRecipient ?? payment.recipient}
                    </dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd className="code-value">{payment.amount} USDC</dd>
                  </div>
                </dl>

                <div className="reason-block">
                  <h3>Reason codes</h3>
                  {payment.report.codes.length > 0 ? (
                    <ul className="code-list">
                      {payment.report.codes.map((code) => (
                        <li key={code}>{code}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">None</p>
                  )}
                </div>

                <p className="disclaimer">
                  ArcShield provides risk indicators, not a safety guarantee.
                </p>

                {payment.report.level === "high" &&
                  payment.report.normalizedRecipient &&
                  flow.stage === "review" &&
                  flow.dialog === "closed" && (
                    <label className="risk-override">
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
                      className="primary-button"
                      ref={reviewButton}
                      type="button"
                      disabled={payment.report.level === "high" && !riskAccepted}
                      onClick={() => openPaymentReview(payment)}
                    >
                      <Wallet aria-hidden="true" size={18} />
                      Review payment
                    </button>
                  )}
              </section>
            ) : flow.stage === "error" ? (
              <div className="status-message error" role="alert">
                <TriangleAlert aria-hidden="true" size={20} />
                <p>{flow.message}</p>
              </div>
            ) : (
              <section className="panel empty-result" aria-labelledby="risk-result-title">
                <span className="icon-box neutral">
                  <ShieldCheck aria-hidden="true" size={20} />
                </span>
                <div>
                  <h2 id="risk-result-title">Risk result</h2>
                  <p>Not checked</p>
                </div>
              </section>
            )}

            {flow.stage === "review" && flow.dialog === "closed" && flow.message && (
              <div className="status-message warning" role="alert">
                <TriangleAlert aria-hidden="true" size={20} />
                <p>{flow.message}</p>
              </div>
            )}

            {flow.stage === "success" && (
              <div
                className="status-message success"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <CircleCheck aria-hidden="true" size={20} />
                <div className="status-content">
                  <p>Payment confirmed.</p>
                  <p className="transaction-hash">
                    <span>Transaction hash</span>
                    <code>{flow.hash}</code>
                  </p>
                  <a href={`${ARC_EXPLORER_URL}/tx/${flow.hash}`}>
                    View transaction
                    <ExternalLink aria-hidden="true" size={15} />
                  </a>
                </div>
              </div>
            )}

            {flow.stage === "pending" && (
              <div
                className="status-message warning"
                role="status"
                aria-label="Transaction status unknown"
                aria-live="polite"
                aria-atomic="true"
              >
                <TriangleAlert aria-hidden="true" size={20} />
                <div className="status-content">
                  <p>
                    Transaction status is unknown after broadcast. Do not resubmit until you
                    check it in the explorer.
                  </p>
                  <p className="transaction-hash">
                    <span>Transaction hash</span>
                    <code>{flow.hash}</code>
                  </p>
                  <a href={`${ARC_EXPLORER_URL}/tx/${flow.hash}`}>
                    Check transaction
                    <ExternalLink aria-hidden="true" size={15} />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
        </main>
      </div>

      {flow.stage === "review" && flow.dialog === "open" && (
        <PaymentDialog
          payment={flow.payment}
          submitting={false}
          onCancel={() => returnToReview(flow.payment)}
          onConfirm={() => confirmPayment(flow.payment)}
        />
      )}

      {flow.stage === "submitting" && <PaymentDialog payment={flow.payment} submitting />}
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
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
    const initialTarget = submitting
      ? dialog.querySelector<HTMLElement>("[data-submitting-focus]")
      : dialog.querySelector<HTMLElement>("[data-initial-focus]");
    initialTarget?.focus();

    const trapFocus = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;

      if (
        elements.length === 1 ||
        !dialog.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [submitting]);

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="payment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-review-title"
      >
        <div className="dialog-heading">
          <span className="icon-box neutral">
            <Wallet aria-hidden="true" size={20} />
          </span>
          <div>
            <h2 id="payment-review-title">Payment review</h2>
            <p>Arc Mainnet (5042)</p>
          </div>
        </div>

        <dl className="detail-list dialog-details">
          <div>
            <dt>Sender</dt>
            <dd className="code-value">{payment.account}</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd className="code-value">{payment.recipient}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd className="code-value">{payment.amount} USDC</dd>
          </div>
          <div>
            <dt>Outer transaction target</dt>
            <dd className="code-value">{MEMO_ADDRESS}</dd>
          </div>
          <div>
            <dt>Memo schema</dt>
            <dd className="code-value">arcshield-payment-receipt</dd>
          </div>
          <div>
            <dt>URL hash</dt>
            <dd className="code-value">{hashWebsite(payment.report.normalizedWebsite)}</dd>
          </div>
          <div>
            <dt>Risk level</dt>
            <dd>{payment.report.level}</dd>
          </div>
          <div>
            <dt>Reason codes</dt>
            <dd className="code-value">
              {payment.report.codes.length > 0 ? payment.report.codes.join(", ") : "None"}
            </dd>
          </div>
          <div>
            <dt>Ruleset</dt>
            <dd className="code-value">{RULESET_VERSION}</dd>
          </div>
        </dl>

        <p className="memo-disclosure">
          The raw URL is not stored onchain, but a predictable URL hash may be guessable.
        </p>
        <p className="disclaimer">ArcShield provides risk indicators, not a safety guarantee.</p>

        {submitting && (
          <p
            className="submitting-status"
            role="status"
            aria-label="Submitting payment"
            tabIndex={0}
            data-submitting-focus
          >
            <LoaderCircle className="spinner" aria-hidden="true" size={18} />
            Submitting payment...
          </p>
        )}

        <div className="dialog-actions">
          <button
            className="secondary-button"
            type="button"
            data-initial-focus
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={submitting}
            onClick={onConfirm}
          >
            <Wallet aria-hidden="true" size={18} />
            Confirm in wallet
          </button>
        </div>
      </section>
    </div>
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

function shortenAddress(account: `0x${string}`): string {
  return `${account.slice(0, 6)}...${account.slice(-4)}`;
}

function unknownTransactionHash(error: unknown): `0x${string}` | undefined {
  return error instanceof ArcShieldError && error.code === "TRANSACTION_STATUS_UNKNOWN"
    ? error.transactionHash
    : undefined;
}
