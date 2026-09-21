import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

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
});
