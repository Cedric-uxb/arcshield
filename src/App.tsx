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
import { analyzePayment, type RiskFinding, type RiskReport } from "./core/risk";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER_URL,
  ArcShieldError,
  MEMO_ADDRESS,
  RULESET_VERSION,
  buildMemoPayment,
  connectWallet,
  getWalletChainId,
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

type WalletNetworkState =
  | { status: "target" }
  | { status: "verified" }
  | { status: "wrong-network"; chainId: number }
  | { status: "unverified" };

type BroadcastOutcome = "unknown" | "replaced" | "cancelled";

type FlowState =
  | { stage: "editing" }
  | { stage: "checking" }
  | { stage: "review"; dialog: "closed"; payment: PaymentSnapshot; message?: string }
  | { stage: "review"; dialog: "open"; payment: ReviewedPayment }
  | { stage: "submitting"; payment: ReviewedPayment }
  | { stage: "success"; payment: ReviewedPayment; hash: `0x${string}` }
  | {
      stage: "pending";
      payment: ReviewedPayment;
      hash: `0x${string}`;
      outcome: BroadcastOutcome;
    }
  | { stage: "error"; message: string };

const AMOUNT_ERROR = "Enter a positive USDC amount with up to 6 decimal places";
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

export default function App() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [website, setWebsite] = useState("");
  const [flow, setFlow] = useState<FlowState>({ stage: "editing" });
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [walletAccount, setWalletAccount] = useState<`0x${string}`>();
  const [walletNetwork, setWalletNetwork] = useState<WalletNetworkState>({ status: "target" });
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");
  const requestVersion = useRef(0);
  const walletStatusVersion = useRef(0);
  const walletAccountRef = useRef<`0x${string}` | undefined>(undefined);
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

  const loadDemoPreset = (
    preset: (typeof DEMO_PRESETS)[keyof typeof DEMO_PRESETS],
  ) => {
    if (paymentLocked) return;
    requestVersion.current += 1;
    setRecipient(preset.recipient);
    setAmount(preset.amount);
    setWebsite(preset.website);
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

  const updateWalletAccount = (account: `0x${string}` | undefined) => {
    walletAccountRef.current = account;
    setWalletAccount(account);
  };

  const refreshHeaderNetwork = async () => {
    const statusRequestId = ++walletStatusVersion.current;
    try {
      const chainId = await getWalletChainId();
      if (statusRequestId !== walletStatusVersion.current) return;
      setWalletNetwork(walletNetworkForChain(chainId));
    } catch (error) {
      if (statusRequestId !== walletStatusVersion.current) return;
      setWalletNetwork({ status: "unverified" });
      setWalletError(errorMessage(error));
    }
  };

  const connectAndRefreshHeader = async () => {
    const account = await connectWallet();
    updateWalletAccount(account);
    setWalletNetwork({ status: "unverified" });
    setWalletError("");
    await refreshHeaderNetwork();
    return account;
  };

  const connectHeaderWallet = async () => {
    setWalletConnecting(true);
    walletStatusVersion.current += 1;
    updateWalletAccount(undefined);
    setWalletNetwork({ status: "target" });
    setWalletError("");
    try {
      await connectAndRefreshHeader();
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
      const account = await connectAndRefreshHeader();
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
    const provider = window.ethereum;
    if (!provider?.on || !provider.removeListener) return;

    const handleChainChanged = (chainIdValue: string) => {
      walletStatusVersion.current += 1;
      setWalletError("");
      if (!walletAccountRef.current) {
        setWalletNetwork({ status: "target" });
        return;
      }
      const chainId = parseWalletChainId(chainIdValue);
      setWalletNetwork(
        chainId === undefined ? { status: "unverified" } : walletNetworkForChain(chainId),
      );
    };
    const handleAccountsChanged = (accounts: string[]) => {
      walletStatusVersion.current += 1;
      const wasConnected = walletAccountRef.current !== undefined;
      const account = walletAddress(accounts[0]);
      updateWalletAccount(account);
      setWalletError("");
      if (!account) {
        setWalletNetwork({ status: "target" });
      } else if (!wasConnected) {
        setWalletNetwork({ status: "unverified" });
      }
    };

    provider.on("chainChanged", handleChainChanged);
    provider.on("accountsChanged", handleAccountsChanged);
    return () => {
      provider.removeListener?.("chainChanged", handleChainChanged);
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, []);

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
      updateWalletAccount(account);
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
      walletStatusVersion.current += 1;
      setWalletNetwork({ status: "verified" });
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
      const broadcast = broadcastError(error);
      if (broadcast) {
        setFlow({ stage: "pending", payment: reviewed, ...broadcast });
        return;
      }
      setFlow({ stage: "error", message: errorMessage(error) });
    }
  };

  const RiskIcon = payment?.report.level === "low" ? CircleCheck : TriangleAlert;
  const broadcastStatus =
    flow.stage === "pending" ? BROADCAST_STATUS[flow.outcome] : undefined;
  const groupedFindings = groupFindings(payment?.report.findings ?? []);

  return (
    <>
      <div className="app-content" inert={modalOpen ? true : undefined}>
        <header className="app-header">
          <div className="brand">
            <ShieldCheck aria-hidden="true" size={22} />
            <strong>ArcShield</strong>
            <small>USDC compliance</small>
          </div>
          <div className="header-controls">
            <span
              className={`network-status ${walletNetwork.status}`}
              aria-live="polite"
            >
              {walletNetwork.status === "target" ? (
                <>
                  <span className="network-label">Target network</span>
                  <span>Arc Mainnet (5042)</span>
                </>
              ) : walletNetwork.status === "verified" ? (
                <>
                  <CircleCheck aria-hidden="true" size={15} />
                  <span>Arc Mainnet verified</span>
                </>
              ) : walletNetwork.status === "wrong-network" ? (
                <>
                  <TriangleAlert aria-hidden="true" size={15} />
                  <span>Wrong network: chain ID {walletNetwork.chainId}</span>
                </>
              ) : (
                <>
                  <TriangleAlert aria-hidden="true" size={15} />
                  <span>Network unverified</span>
                </>
              )}
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
          <h1>Review the evidence before you pay</h1>
          <p>Explainable checks and an Arc-recorded decision trail for USDC payments.</p>
          <ol className="process-steps" aria-label="Compliance payment flow">
            <li>
              <Search aria-hidden="true" size={16} />
              <strong>Inspect</strong>
            </li>
            <li>
              <TriangleAlert aria-hidden="true" size={16} />
              <strong>Review</strong>
            </li>
            <li>
              <CircleCheck aria-hidden="true" size={16} />
              <strong>Record</strong>
            </li>
          </ol>
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={paymentLocked}
                  style={{ flex: "1 1 12rem", minHeight: "2.25rem", padding: "0.375rem 0.75rem" }}
                  onClick={() => loadDemoPreset(DEMO_PRESETS.low)}
                >
                  Load low-indicator example
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={paymentLocked}
                  style={{ flex: "1 1 12rem", minHeight: "2.25rem", padding: "0.375rem 0.75rem" }}
                  onClick={() => loadDemoPreset(DEMO_PRESETS.high)}
                >
                  Load high-risk example
                </button>
              </div>

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

                <EvidenceGroup
                  title="Address evidence"
                  findings={groupedFindings.address}
                  empty="Bytecode and USDC denylist checks found no warnings. Sender matching is performed during wallet review."
                />
                <EvidenceGroup
                  title="Website evidence"
                  findings={groupedFindings.website}
                  empty={
                    payment.website.trim()
                      ? "No website structure findings were found."
                      : "No website was supplied for structure checks."
                  }
                />

                <div className="reason-block">
                  <h3>Arc verification</h3>
                  <p className="muted">
                    {payment.report.normalizedRecipient
                      ? "Bytecode and USDC denylist reads completed."
                      : "Onchain reads require a valid recipient."}
                  </p>
                  <p className="muted">
                    Ruleset <code>{RULESET_VERSION}</code>
                  </p>
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
                  <dl className="detail-list">
                    <div>
                      <dt>Recipient bytecode</dt>
                      <dd>Pending valid recipient</dd>
                    </div>
                    <div>
                      <dt>USDC denylist status</dt>
                      <dd>Pending valid recipient</dd>
                    </div>
                    <div>
                      <dt>URL structure</dt>
                      <dd>Pending risk check</dd>
                    </div>
                  </dl>
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
                aria-label={broadcastStatus?.label}
                aria-live="polite"
                aria-atomic="true"
              >
                <TriangleAlert aria-hidden="true" size={20} />
                <div className="status-content">
                  <p>{broadcastStatus?.message}</p>
                  <p className="transaction-hash">
                    <span>{broadcastStatus?.hashLabel}</span>
                    <code>{flow.hash}</code>
                  </p>
                  <a href={`${ARC_EXPLORER_URL}/tx/${flow.hash}`}>
                    {broadcastStatus?.linkLabel}
                    <ExternalLink aria-hidden="true" size={15} />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        <section className="proof-strip" aria-labelledby="proof-strip-title">
          <h2 id="proof-strip-title">Decision trail</h2>
          <ol>
            <li>
              <Search aria-hidden="true" size={18} />
              <div>
                <h3>Deterministic checks</h3>
                <p>Address and URL evidence</p>
              </div>
            </li>
            <li>
              <Wallet aria-hidden="true" size={18} />
              <div>
                <h3>Wallet review</h3>
                <p>Human confirmation before payment</p>
              </div>
            </li>
            <li>
              <ShieldCheck aria-hidden="true" size={18} />
              <div>
                <h3>Arc Memo record</h3>
                <p>Ruleset and decision data</p>
              </div>
            </li>
            <li>
              <ExternalLink aria-hidden="true" size={18} />
              <div>
                <h3>Explorer receipt</h3>
                <p>Available after a confirmed payment</p>
              </div>
            </li>
          </ol>
        </section>
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

function groupFindings(findings: RiskFinding[]): {
  address: RiskFinding[];
  website: RiskFinding[];
} {
  return {
    address: findings.filter((finding) => finding.code.startsWith("ADDRESS_")),
    website: findings.filter((finding) => finding.code.startsWith("URL_")),
  };
}

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
    <div className="reason-block">
      <h3>{title}</h3>
      {findings.length > 0 ? (
        <ul className="code-list">
          {findings.map((finding) => (
            <li key={finding.code}>
              <code>{finding.code}</code> {finding.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
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

function walletNetworkForChain(chainId: number): WalletNetworkState {
  return chainId === ARC_CHAIN_ID
    ? { status: "verified" }
    : { status: "wrong-network", chainId };
}

function parseWalletChainId(value: string): number | undefined {
  if (!/^(?:0x[\da-f]+|\d+)$/i.test(value)) return undefined;
  const chainId = Number(BigInt(value));
  return Number.isSafeInteger(chainId) ? chainId : undefined;
}

function walletAddress(value: string | undefined): `0x${string}` | undefined {
  return value && /^0x[\da-f]{40}$/i.test(value) ? (value as `0x${string}`) : undefined;
}

const BROADCAST_STATUS = {
  unknown: {
    label: "Transaction status unknown",
    message:
      "Transaction status is unknown after broadcast. Do not resubmit until you check it in the explorer.",
    hashLabel: "Transaction hash",
    linkLabel: "Check transaction",
  },
  replaced: {
    label: "Transaction replaced",
    message:
      "The payment was replaced by a different transaction. Inspect the replacement before retrying.",
    hashLabel: "Replacement hash",
    linkLabel: "Inspect replacement",
  },
  cancelled: {
    label: "Payment cancelled",
    message: "The payment was cancelled by a replacement transaction.",
    hashLabel: "Cancellation hash",
    linkLabel: "View cancellation",
  },
} as const satisfies Record<
  BroadcastOutcome,
  { label: string; message: string; hashLabel: string; linkLabel: string }
>;

function broadcastError(
  error: unknown,
): { outcome: BroadcastOutcome; hash: `0x${string}` } | undefined {
  if (!(error instanceof ArcShieldError) || !error.transactionHash) return undefined;
  if (error.code === "TRANSACTION_STATUS_UNKNOWN") {
    return { outcome: "unknown", hash: error.transactionHash };
  }
  if (error.code === "TRANSACTION_REPLACED") {
    return { outcome: "replaced", hash: error.transactionHash };
  }
  if (error.code === "TRANSACTION_CANCELLED") {
    return { outcome: "cancelled", hash: error.transactionHash };
  }
  return undefined;
}
