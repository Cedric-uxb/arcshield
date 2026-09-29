import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARC_CHAIN_ID,
  ArcShieldError,
  MEMO_ADDRESS,
  RULESET_VERSION,
  hashWebsite,
} from "./lib/arc";
import App from "./App";

const arc = vi.hoisted(() => ({
  inspectRecipient: vi.fn(),
  connectWallet: vi.fn(),
  getWalletChainId: vi.fn(),
  switchToArc: vi.fn(),
  buildMemoPayment: vi.fn(),
  sendGuardedPayment: vi.fn(),
}));

vi.mock("./lib/arc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/arc")>();
  return {
    ...actual,
    inspectRecipient: arc.inspectRecipient,
    connectWallet: arc.connectWallet,
    getWalletChainId: arc.getWalletChainId,
    switchToArc: arc.switchToArc,
    buildMemoPayment: arc.buildMemoPayment,
    sendGuardedPayment: arc.sendGuardedPayment,
  };
});

const recipient = "0x2222222222222222222222222222222222222222";
const secondRecipient = "0x3333333333333333333333333333333333333333";
const account = "0x1111111111111111111111111111111111111111";
const secondAccount = "0x4444444444444444444444444444444444444444";
const transactionHash = `0x${"ab".repeat(32)}` as const;
const replacementHash = `0x${"cd".repeat(32)}` as const;

type ProviderEvent = "chainChanged" | "accountsChanged";
type ProviderListener = (value: string | string[]) => void;

let providerListeners = new Map<ProviderEvent, Set<ProviderListener>>();
const providerOn = vi.fn();
const providerRemoveListener = vi.fn();

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function enterPayment({
  recipientAddress = recipient,
  amount = "1.25",
  website,
}: {
  recipientAddress?: string;
  amount?: string;
  website?: string;
} = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Recipient address"), recipientAddress);
  if (amount) await user.type(screen.getByLabelText("Amount in USDC"), amount);
  if (website) {
    await user.type(screen.getByLabelText("Associated website (optional)"), website);
  }
  await user.click(screen.getByRole("button", { name: "Run risk check" }));
  return user;
}

async function emitProviderEvent(event: ProviderEvent, value: string | string[]) {
  await act(async () => {
    providerListeners.get(event)?.forEach((listener) => listener(value));
  });
}

beforeEach(() => {
  arc.inspectRecipient.mockReset().mockResolvedValue({ hasCode: false, denylisted: false });
  arc.connectWallet.mockReset().mockResolvedValue(account);
  arc.getWalletChainId.mockReset().mockResolvedValue(ARC_CHAIN_ID);
  arc.switchToArc.mockReset().mockResolvedValue(undefined);
  arc.buildMemoPayment.mockReset().mockReturnValue({ payment: true });
  arc.sendGuardedPayment.mockReset().mockResolvedValue({
    hash: transactionHash,
    receipt: { status: "success" },
  });
  providerListeners = new Map();
  providerOn.mockReset().mockImplementation(
    (event: ProviderEvent, listener: ProviderListener) => {
      const listeners = providerListeners.get(event) ?? new Set<ProviderListener>();
      listeners.add(listener);
      providerListeners.set(event, listeners);
    },
  );
  providerRemoveListener.mockReset().mockImplementation(
    (event: ProviderEvent, listener: ProviderListener) => {
      providerListeners.get(event)?.delete(listener);
    },
  );
  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: {
      request: vi.fn(),
      on: providerOn,
      removeListener: providerRemoveListener,
    } as unknown as Window["ethereum"],
  });
});

describe("App", () => {
  it("renders the working payment-check form", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Check before you pay" })).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient address")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in USDC")).toBeInTheDocument();
    expect(screen.getByLabelText("Associated website (optional)")).toBeInTheDocument();
    expect(screen.getByText("Target network").parentElement).toHaveTextContent(
      /Target network\s*Arc Mainnet \(5042\)/,
    );

    const button = screen.getByRole("button", { name: "Run risk check" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "submit");
  });

  it("loads the low-indicator example without running a risk check", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Load low-indicator example" }));

    expect(screen.getByLabelText("Recipient address")).toHaveValue(recipient);
    expect(screen.getByLabelText("Amount in USDC")).toHaveValue("25");
    expect(screen.getByLabelText("Associated website (optional)")).toHaveValue(
      "https://merchant.example",
    );
    expect(arc.inspectRecipient).not.toHaveBeenCalled();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.queryByText("ADDRESS_ZERO")).not.toBeInTheDocument();
  });

  it("runs the normal risk check for the high-risk example", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Load high-risk example" }));
    await user.click(screen.getByRole("button", { name: "Run risk check" }));

    expect(await screen.findByText("ADDRESS_ZERO")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I understand the risk" })).toBeInTheDocument();
  });

  it("clears a completed high-risk result and accepted risk when loading a preset", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Load high-risk example" }));
    await user.click(screen.getByRole("button", { name: "Run risk check" }));
    const override = await screen.findByRole("checkbox", { name: "I understand the risk" });
    await user.click(override);
    expect(override).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Load low-indicator example" }));

    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.queryByText("ADDRESS_ZERO")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "I understand the risk" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review payment" })).not.toBeInTheDocument();
  });

  it("verifies Arc Mainnet after the header wallet connects", async () => {
    render(<App />);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.getByText("Target network").parentElement).toHaveTextContent(
      /Target network\s*Arc Mainnet \(5042\)/,
    );

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(await screen.findByRole("button", { name: `Connected wallet ${account}` })).toHaveTextContent(
      "0x1111...1111",
    );
    expect(screen.getByText("Arc Mainnet verified").parentElement).toHaveClass("verified");
    expect(arc.connectWallet).toHaveBeenCalledOnce();
    expect(arc.getWalletChainId).toHaveBeenCalledOnce();
    expect(arc.switchToArc).not.toHaveBeenCalled();
  });

  it("shows the actual chain id when the connected wallet is on the wrong network", async () => {
    arc.getWalletChainId.mockResolvedValue(1);
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    const network = await screen.findByText(/Wrong network.*chain ID 1/i);
    expect(network.parentElement).toHaveClass("wrong-network");
    expect(screen.getByRole("button", { name: `Connected wallet ${account}` })).toBeInTheDocument();
    expect(arc.switchToArc).not.toHaveBeenCalled();
  });

  it("keeps the account visible but does not claim verification when the chain query fails", async () => {
    arc.getWalletChainId.mockRejectedValue(
      new ArcShieldError("RPC_FAILURE", "The wallet network could not be read."),
    );
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The wallet network could not be read.",
    );
    expect(screen.getByText("Network unverified").parentElement).toHaveClass("unverified");
    expect(screen.getByRole("button", { name: `Connected wallet ${account}` })).toBeInTheDocument();
    expect(screen.queryByText("Arc Mainnet verified")).not.toBeInTheDocument();
    expect(arc.switchToArc).not.toHaveBeenCalled();
  });

  it("handles header wallet connection errors without changing the network claim", async () => {
    arc.connectWallet.mockRejectedValue(
      new ArcShieldError("USER_REJECTED", "The wallet request was cancelled."),
    );
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You rejected the wallet request");
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeEnabled();
    expect(screen.getByText("Target network").parentElement).toHaveTextContent(
      /Target network\s*Arc Mainnet \(5042\)/,
    );
    expect(arc.getWalletChainId).not.toHaveBeenCalled();
  });

  it("invalidates a verified header immediately when the provider chain changes", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByText("Arc Mainnet verified")).toBeInTheDocument();

    await emitProviderEvent("chainChanged", "0x1");

    expect(screen.getByText("Wrong network: chain ID 1").parentElement).toHaveClass(
      "wrong-network",
    );
    expect(screen.queryByText("Arc Mainnet verified")).not.toBeInTheDocument();
    expect(arc.switchToArc).not.toHaveBeenCalled();
  });

  it("updates and clears the connected account from provider events", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    await emitProviderEvent("accountsChanged", [secondAccount]);
    expect(
      screen.getByRole("button", { name: `Connected wallet ${secondAccount}` }),
    ).toHaveTextContent("0x4444...4444");

    await emitProviderEvent("accountsChanged", []);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.getByText("Target network").parentElement).toHaveTextContent(
      /Target network\s*Arc Mainnet \(5042\)/,
    );
  });

  it("removes injected provider listeners on unmount", () => {
    const { unmount } = render(<App />);
    const chainListener = providerOn.mock.calls.find(([event]) => event === "chainChanged")?.[1];
    const accountsListener = providerOn.mock.calls.find(
      ([event]) => event === "accountsChanged",
    )?.[1];

    unmount();

    expect(providerRemoveListener).toHaveBeenCalledWith("chainChanged", chainListener);
    expect(providerRemoveListener).toHaveBeenCalledWith("accountsChanged", accountsListener);
  });

  it("renders ADDRESS_INVALID without offering payment review", async () => {
    render(<App />);

    await enterPayment({ recipientAddress: "not-an-address" });

    expect(await screen.findByText("ADDRESS_INVALID")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review payment" })).not.toBeInTheDocument();
    expect(arc.inspectRecipient).not.toHaveBeenCalled();
  });

  it("renders contract and insecure website warning reasons", async () => {
    arc.inspectRecipient.mockResolvedValue({ hasCode: true, denylisted: false });
    render(<App />);

    await enterPayment({ website: "http://example.com" });

    expect(await screen.findByText("ADDRESS_CONTRACT")).toBeInTheDocument();
    const result = screen.getByRole("region", { name: "Risk result" });
    expect(result).toHaveAttribute("aria-live", "polite");
    expect(result).toHaveClass("risk-warning");
    expect(screen.getByText("URL_NO_HTTPS")).toBeInTheDocument();
  });

  it("submits a malformed website for explicit URL_INVALID analysis", async () => {
    render(<App />);

    await enterPayment({ website: "not a url" });

    expect(await screen.findByText("URL_INVALID")).toBeInTheDocument();
  });

  it("requires an explicit override before reviewing a high-risk payment", async () => {
    arc.inspectRecipient.mockResolvedValue({ hasCode: false, denylisted: true });
    render(<App />);

    const user = await enterPayment();
    const override = await screen.findByRole("checkbox", { name: "I understand the risk" });
    const review = screen.getByRole("button", { name: "Review payment" });

    expect(override).not.toBeChecked();
    expect(review).toBeDisabled();
    await user.click(override);
    expect(review).toBeEnabled();
  });

  it("invalidates a completed check when payment details change", async () => {
    render(<App />);
    const user = await enterPayment();
    expect(await screen.findByRole("button", { name: "Review payment" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Recipient address"), "1");

    expect(screen.queryByRole("button", { name: "Review payment" })).not.toBeInTheDocument();
  });

  it("ignores a superseded recipient inspection result", async () => {
    const firstInspection = deferred<{ hasCode: boolean; denylisted: boolean }>();
    arc.inspectRecipient
      .mockReturnValueOnce(firstInspection.promise)
      .mockResolvedValueOnce({ hasCode: false, denylisted: false });
    render(<App />);
    const user = userEvent.setup();
    const recipientInput = screen.getByLabelText("Recipient address");
    await user.type(recipientInput, recipient);
    await user.type(screen.getByLabelText("Amount in USDC"), "1.25");
    await user.click(screen.getByRole("button", { name: "Run risk check" }));

    await user.clear(recipientInput);
    await user.type(recipientInput, secondRecipient);
    await user.click(screen.getByRole("button", { name: "Run risk check" }));

    expect(await screen.findByRole("button", { name: "Review payment" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Risk result" })).toHaveTextContent(secondRecipient);
    await act(async () => firstInspection.resolve({ hasCode: true, denylisted: true }));
    expect(screen.queryByText("ADDRESS_CONTRACT")).not.toBeInTheDocument();
    expect(screen.queryByText("ADDRESS_DENYLISTED")).not.toBeInTheDocument();
    expect(arc.inspectRecipient).toHaveBeenNthCalledWith(1, recipient);
    expect(arc.inspectRecipient).toHaveBeenNthCalledWith(2, secondRecipient);
  });

  it("keeps a loaded preset when a superseded inspection resolves", async () => {
    const inspection = deferred<{ hasCode: boolean; denylisted: boolean }>();
    arc.inspectRecipient.mockReturnValueOnce(inspection.promise);
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Recipient address"), secondRecipient);
    await user.type(screen.getByLabelText("Amount in USDC"), "1.25");
    await user.click(screen.getByRole("button", { name: "Run risk check" }));
    await waitFor(() => expect(arc.inspectRecipient).toHaveBeenCalledWith(secondRecipient));

    await user.click(screen.getByRole("button", { name: "Load low-indicator example" }));
    await act(async () => inspection.resolve({ hasCode: true, denylisted: true }));

    expect(screen.getByLabelText("Recipient address")).toHaveValue(recipient);
    expect(screen.getByLabelText("Amount in USDC")).toHaveValue("25");
    expect(screen.getByLabelText("Associated website (optional)")).toHaveValue(
      "https://merchant.example",
    );
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.queryByText("ADDRESS_CONTRACT")).not.toBeInTheDocument();
    expect(screen.queryByText("ADDRESS_DENYLISTED")).not.toBeInTheDocument();
  });

  it("shows the complete Arc payment review", async () => {
    render(<App />);
    const user = await enterPayment({
      recipientAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
      website: "http://example.com",
    });

    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    const dialog = await screen.findByRole("dialog", { name: "Payment review" });
    expect(dialog).toHaveAttribute("aria-labelledby", "payment-review-title");
    expect(screen.getByRole("heading", { name: "Payment review" })).toHaveAttribute(
      "id",
      "payment-review-title",
    );
    expect(dialog).toHaveTextContent("Arc Mainnet (5042)");
    expect(dialog).toHaveTextContent("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(dialog).toHaveTextContent(account);
    expect(dialog).toHaveTextContent("1.25 USDC");
    expect(dialog).toHaveTextContent(MEMO_ADDRESS);
    expect(dialog).toHaveTextContent("arcshield-payment-receipt");
    expect(dialog).toHaveTextContent(hashWebsite("http://example.com/"));
    expect(dialog).toHaveTextContent("warning");
    expect(dialog).toHaveTextContent("URL_NO_HTTPS");
    expect(dialog).toHaveTextContent(RULESET_VERSION);
    expect(dialog).toHaveTextContent(/raw URL is not stored/i);
    expect(dialog).toHaveTextContent(/predictable URL hash may be guessable/i);
    expect(dialog).toHaveTextContent(/indicators.*not a safety guarantee/i);
    expect(screen.getByRole("button", { name: "Confirm in wallet" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it.each([
    {
      chainId: ARC_CHAIN_ID,
      statusText: "Arc Mainnet verified",
      statusClass: "verified",
    },
    {
      chainId: 1,
      statusText: "Wrong network: chain ID 1",
      statusClass: "wrong-network",
    },
  ])(
    "synchronizes header chain $chainId when review connects the wallet",
    async ({ chainId, statusText, statusClass }) => {
      arc.getWalletChainId.mockResolvedValue(chainId);
      render(<App />);
      const user = await enterPayment();

      await user.click(await screen.findByRole("button", { name: "Review payment" }));

      expect(await screen.findByRole("dialog", { name: "Payment review" })).toHaveTextContent(
        "Arc Mainnet (5042)",
      );
      expect(screen.getByText(statusText).parentElement).toHaveClass(statusClass);
      expect(screen.getByRole("button", { name: `Connected wallet ${account}` })).toBeInTheDocument();
      expect(arc.getWalletChainId).toHaveBeenCalledOnce();
      expect(arc.switchToArc).not.toHaveBeenCalled();
    },
  );

  it("marks long amount values for wrapping in results and payment review", async () => {
    const longAmount = `${"1234567890".repeat(5)}.123456`;
    render(<App />);
    const user = await enterPayment({ amount: longAmount });

    const result = await screen.findByRole("region", { name: "Risk result" });
    expect(within(result).getByText(`${longAmount} USDC`)).toHaveClass("code-value");

    await user.click(screen.getByRole("button", { name: "Review payment" }));
    const dialog = await screen.findByRole("dialog", { name: "Payment review" });
    expect(within(dialog).getByText(`${longAmount} USDC`)).toHaveClass("code-value");
  });

  it("shows a friendly error when the wallet request is rejected", async () => {
    arc.connectWallet.mockRejectedValue(
      new ArcShieldError("USER_REJECTED", "The wallet request was cancelled."),
    );
    render(<App />);
    const user = await enterPayment();

    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You rejected the wallet request");
    expect(screen.queryByRole("link", { name: /view transaction/i })).not.toBeInTheDocument();
  });

  it.each(["", "0", "-1", "1.0000001", "1e3", "not-a-number"])(
    "rejects invalid amount %j before connecting a wallet",
    async (amount) => {
      render(<App />);
      const user = await enterPayment({ amount });

      await user.click(await screen.findByRole("button", { name: "Review payment" }));

      expect(
        await screen.findByText("Enter a positive USDC amount with up to 6 decimal places"),
      ).toBeInTheDocument();
      expect(arc.connectWallet).not.toHaveBeenCalled();
    },
  );

  it("refreshes the sender for each payment review", async () => {
    arc.connectWallet.mockResolvedValueOnce(account).mockResolvedValueOnce(secondAccount);
    render(<App />);
    const user = await enterPayment();
    const review = await screen.findByRole("button", { name: "Review payment" });

    await user.click(review);
    expect(await screen.findByRole("dialog", { name: "Payment review" })).toHaveTextContent(account);
    expect(screen.getByRole("button", { name: `Connected wallet ${account}` })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Review payment" }));

    expect(await screen.findByRole("dialog", { name: "Payment review" })).toHaveTextContent(
      secondAccount,
    );
    expect(
      screen.getByRole("button", { name: `Connected wallet ${secondAccount}` }),
    ).toBeInTheDocument();
    expect(arc.connectWallet).toHaveBeenCalledTimes(2);
  });

  it("requires a fresh review if the wallet account changes at confirmation", async () => {
    arc.connectWallet.mockResolvedValueOnce(account).mockResolvedValueOnce(secondAccount);
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));

    expect(
      await screen.findByText("Wallet account changed. Review the payment again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review payment" })).toBeInTheDocument();
    expect(arc.switchToArc).not.toHaveBeenCalled();
    expect(arc.sendGuardedPayment).not.toHaveBeenCalled();
  });

  it("requires a fresh override when recipient risk changes at confirmation", async () => {
    arc.inspectRecipient
      .mockResolvedValueOnce({ hasCode: false, denylisted: false })
      .mockResolvedValueOnce({ hasCode: true, denylisted: true });
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));

    expect(
      await screen.findByText("Risk indicators changed. Review the payment again."),
    ).toBeInTheDocument();
    expect(screen.getByText("ADDRESS_CONTRACT")).toBeInTheDocument();
    expect(screen.getByText("ADDRESS_DENYLISTED")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I understand the risk" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Review payment" })).toBeDisabled();
    expect(arc.switchToArc).not.toHaveBeenCalled();
    expect(arc.sendGuardedPayment).not.toHaveBeenCalled();
  });

  it("runs the risk check when Enter submits the form", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Recipient address"), recipient);
    await user.type(screen.getByLabelText("Amount in USDC"), "1.25{Enter}");

    await waitFor(() => expect(arc.inspectRecipient).toHaveBeenCalledWith(recipient));
    expect(await screen.findByRole("button", { name: "Review payment" })).toBeInTheDocument();
  });

  it("supports dialog focus, Escape, Cancel, and focus return", async () => {
    render(<App />);
    const user = await enterPayment();
    const review = await screen.findByRole("button", { name: "Review payment" });
    await user.click(review);

    expect(await screen.findByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Payment review" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review payment" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Review payment" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await user.click(cancel);
    expect(screen.queryByRole("dialog", { name: "Payment review" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review payment" })).toHaveFocus());
  });

  it("makes the background inert and traps focus inside review and submitting dialogs", async () => {
    const switching = deferred<void>();
    arc.switchToArc.mockReturnValue(switching.promise);
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    const background = screen.getByRole("main").parentElement;
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm in wallet" });
    expect(background).toHaveAttribute("inert");
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.click(confirm);
    const submittingStatus = screen.getByRole("status", { name: "Submitting payment" });
    await waitFor(() => expect(submittingStatus).toHaveFocus());
    await user.tab();
    expect(submittingStatus).toHaveFocus();
    expect(background).toHaveAttribute("inert");

    await act(async () => switching.resolve());
    await screen.findByRole("link", { name: /view transaction/i });
    expect(background).not.toHaveAttribute("inert");
  });

  it("keeps background controls disabled and only lets Escape close review", async () => {
    const switching = deferred<void>();
    arc.switchToArc.mockReturnValue(switching.promise);
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    expect(screen.getByLabelText("Recipient address")).toBeDisabled();
    expect(screen.getByLabelText("Amount in USDC")).toBeDisabled();
    expect(screen.getByLabelText("Associated website (optional)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load low-indicator example" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load high-risk example" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run risk check" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Payment review" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review payment" }));
    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Payment review" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Submitting payment");

    await act(async () => switching.resolve());
    expect(await screen.findByRole("link", { name: /view transaction/i })).toBeInTheDocument();
  });

  it("keeps the reviewed payment visible and immutable while submitting", async () => {
    const switching = deferred<void>();
    const sending = deferred<{ hash: `0x${string}`; receipt: { status: string } }>();
    arc.switchToArc.mockReturnValue(switching.promise);
    arc.sendGuardedPayment.mockReturnValue(sending.promise);
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));
    await user.click(await screen.findByRole("button", { name: "Confirm in wallet" }));

    const recipientInput = screen.getByLabelText("Recipient address");
    const amountInput = screen.getByLabelText("Amount in USDC");
    expect(recipientInput).toBeDisabled();
    expect(amountInput).toBeDisabled();
    await user.type(amountInput, "9");
    expect(amountInput).toHaveValue("1.25");
    expect(screen.getByRole("dialog", { name: "Payment review" })).toHaveTextContent("1.25 USDC");
    expect(screen.getByRole("button", { name: "Confirm in wallet" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Submitting payment");

    await act(async () => switching.resolve());
    await waitFor(() => expect(arc.sendGuardedPayment).toHaveBeenCalledWith({ payment: true }));
    expect(amountInput).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Payment review" })).toHaveTextContent("1.25 USDC");
    await act(async () =>
      sending.resolve({ hash: transactionHash, receipt: { status: "success" } }),
    );
    expect(await screen.findByRole("link", { name: /view transaction/i })).toBeInTheDocument();
    expect(arc.buildMemoPayment).toHaveBeenCalledWith(
      expect.objectContaining({ account, recipient, amount: "1.25" }),
    );
  });

  it("links to the confirmed transaction receipt", async () => {
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));
    await user.click(await screen.findByRole("button", { name: "Confirm in wallet" }));

    const link = await screen.findByRole("link", { name: /view transaction/i });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(within(status).getByRole("link", { name: /view transaction/i })).toBe(link);
    expect(status).toHaveTextContent(transactionHash);
    expect(link).toHaveAttribute("href", `https://explorer.arc.io/tx/${transactionHash}`);
    expect(arc.switchToArc).toHaveBeenCalledOnce();
    expect(arc.buildMemoPayment).toHaveBeenCalledWith(
      expect.objectContaining({ account, recipient, amount: "1.25" }),
    );
    expect(arc.sendGuardedPayment).toHaveBeenCalledWith({ payment: true });
  });

  it("marks the header verified after confirmation switches to Arc Mainnet", async () => {
    arc.getWalletChainId.mockResolvedValue(1);
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));
    expect(screen.getByText("Wrong network: chain ID 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));

    await screen.findByRole("link", { name: /view transaction/i });
    expect(screen.getByText("Arc Mainnet verified").parentElement).toHaveClass("verified");
    expect(arc.switchToArc).toHaveBeenCalledOnce();
  });

  it("shows a locked pending state when broadcast receipt status is unknown", async () => {
    const unknownError = new ArcShieldError(
      "TRANSACTION_STATUS_UNKNOWN",
      "Transaction receipt status is unknown.",
      undefined,
      transactionHash,
    );
    arc.sendGuardedPayment.mockRejectedValue(unknownError);
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));
    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));

    const status = await screen.findByRole("status", { name: "Transaction status unknown" });
    expect(status).toHaveTextContent(transactionHash);
    expect(within(status).getByRole("link", { name: /check transaction/i })).toHaveAttribute(
      "href",
      `https://explorer.arc.io/tx/${transactionHash}`,
    );
    expect(screen.getByLabelText("Recipient address")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run risk check" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Review payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm in wallet" })).not.toBeInTheDocument();
    expect(arc.sendGuardedPayment).toHaveBeenCalledOnce();
  });

  it("shows a replacement hash and requires inspection before retrying", async () => {
    arc.sendGuardedPayment.mockRejectedValue(
      new ArcShieldError(
        "TRANSACTION_REPLACED",
        "The Arc payment was replaced by a different transaction.",
        undefined,
        replacementHash,
      ),
    );
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));
    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));

    const status = await screen.findByRole("status", { name: "Transaction replaced" });
    expect(status).toHaveTextContent(/inspect the replacement before retrying/i);
    expect(status).toHaveTextContent(replacementHash);
    expect(within(status).getByRole("link", { name: /inspect replacement/i })).toHaveAttribute(
      "href",
      `https://explorer.arc.io/tx/${replacementHash}`,
    );
    expect(screen.queryByText("Payment confirmed.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review payment" })).not.toBeInTheDocument();
  });

  it("shows a cancellation hash without reporting payment success", async () => {
    arc.sendGuardedPayment.mockRejectedValue(
      new ArcShieldError(
        "TRANSACTION_CANCELLED",
        "The Arc payment was cancelled by a replacement transaction.",
        undefined,
        replacementHash,
      ),
    );
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));
    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));

    const status = await screen.findByRole("status", { name: "Payment cancelled" });
    expect(status).toHaveTextContent(/payment was cancelled/i);
    expect(status).toHaveTextContent(replacementHash);
    expect(within(status).getByRole("link", { name: /view cancellation/i })).toHaveAttribute(
      "href",
      `https://explorer.arc.io/tx/${replacementHash}`,
    );
    expect(screen.queryByText("Payment confirmed.")).not.toBeInTheDocument();
  });

  it("shows a friendly error when wallet confirmation is rejected", async () => {
    arc.switchToArc.mockRejectedValue(
      new ArcShieldError("USER_REJECTED", "The wallet request was cancelled."),
    );
    render(<App />);
    const user = await enterPayment();
    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    await user.click(screen.getByRole("button", { name: "Confirm in wallet" }));

    expect(await screen.findByText("You rejected the wallet request")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view transaction/i })).not.toBeInTheDocument();
    expect(arc.sendGuardedPayment).not.toHaveBeenCalled();
  });
});
