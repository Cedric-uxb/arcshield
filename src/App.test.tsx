import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArcShieldError } from "./lib/arc";
import App from "./App";

const arc = vi.hoisted(() => ({
  inspectRecipient: vi.fn(),
  connectWallet: vi.fn(),
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

beforeEach(() => {
  arc.inspectRecipient.mockReset().mockResolvedValue({ hasCode: false, denylisted: false });
  arc.connectWallet.mockReset().mockResolvedValue(account);
  arc.switchToArc.mockReset().mockResolvedValue(undefined);
  arc.buildMemoPayment.mockReset().mockReturnValue({ payment: true });
  arc.sendGuardedPayment.mockReset().mockResolvedValue({
    hash: transactionHash,
    receipt: { status: "success" },
  });
});

describe("App", () => {
  it("renders the working payment-check form", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Check before you pay" })).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient address")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount in USDC")).toBeInTheDocument();
    expect(screen.getByLabelText("Associated website (optional)")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Run risk check" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "submit");
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
    expect(screen.getByText("URL_NO_HTTPS")).toBeInTheDocument();
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

  it("shows the complete Arc payment review", async () => {
    render(<App />);
    const user = await enterPayment({
      recipientAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
      website: "http://example.com",
    });

    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    const dialog = await screen.findByRole("dialog", { name: "Payment review" });
    expect(dialog).toHaveTextContent("Arc Mainnet (5042)");
    expect(dialog).toHaveTextContent("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(dialog).toHaveTextContent(account);
    expect(dialog).toHaveTextContent("1.25 USDC");
    expect(dialog).toHaveTextContent("URL_NO_HTTPS");
    expect(dialog).toHaveTextContent(/indicators.*not a safety guarantee/i);
    expect(screen.getByRole("button", { name: "Confirm in wallet" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("shows a friendly error when the wallet request is rejected", async () => {
    arc.connectWallet.mockRejectedValue(
      new ArcShieldError("USER_REJECTED", "The wallet request was cancelled."),
    );
    render(<App />);
    const user = await enterPayment();

    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    expect(await screen.findByText("You rejected the wallet request")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Review payment" }));

    expect(await screen.findByRole("dialog", { name: "Payment review" })).toHaveTextContent(
      secondAccount,
    );
    expect(arc.connectWallet).toHaveBeenCalledTimes(2);
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
    expect(link).toHaveAttribute("href", `https://explorer.arc.io/tx/${transactionHash}`);
    expect(arc.switchToArc).toHaveBeenCalledOnce();
    expect(arc.buildMemoPayment).toHaveBeenCalledWith(
      expect.objectContaining({ account, recipient, amount: "1.25" }),
    );
    expect(arc.sendGuardedPayment).toHaveBeenCalledWith({ payment: true });
  });
});
