import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const arc = vi.hoisted(() => ({
  inspectRecipient: vi.fn(),
  connectWallet: vi.fn(),
  switchToArc: vi.fn(),
  buildMemoPayment: vi.fn(),
  sendGuardedPayment: vi.fn(),
}));

vi.mock("./lib/arc", () => ({
  ARC_EXPLORER_URL: "https://explorer.arc.io",
  inspectRecipient: arc.inspectRecipient,
  connectWallet: arc.connectWallet,
  switchToArc: arc.switchToArc,
  buildMemoPayment: arc.buildMemoPayment,
  sendGuardedPayment: arc.sendGuardedPayment,
}));

const recipient = "0x2222222222222222222222222222222222222222";
const account = "0x1111111111111111111111111111111111111111";
const transactionHash = `0x${"ab".repeat(32)}`;

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
  await user.type(screen.getByLabelText("Amount in USDC"), amount);
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
    expect(button).toHaveAttribute("type", "button");
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
    expect(dialog).toHaveTextContent("1.25 USDC");
    expect(dialog).toHaveTextContent("URL_NO_HTTPS");
    expect(dialog).toHaveTextContent(/indicators.*not a safety guarantee/i);
    expect(screen.getByRole("button", { name: "Confirm in wallet" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("shows a friendly error when the wallet request is rejected", async () => {
    arc.connectWallet.mockRejectedValue(Object.assign(new Error("Rejected"), { code: 4001 }));
    render(<App />);
    const user = await enterPayment();

    await user.click(await screen.findByRole("button", { name: "Review payment" }));

    expect(await screen.findByText("You rejected the wallet request")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view transaction/i })).not.toBeInTheDocument();
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
