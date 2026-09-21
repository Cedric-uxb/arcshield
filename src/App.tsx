export default function App() {
  return (
    <>
      <header>
        <strong>ArcShield</strong>
        <span>Arc mainnet</span>
      </header>

      <main>
        <h1>Check before you pay</h1>
        <form>
          <label>
            Recipient address
            <input name="recipient" autoComplete="off" />
          </label>

          <label>
            Amount in USDC
            <input name="amount" inputMode="decimal" />
          </label>

          <label>
            Associated website (optional)
            <input name="website" type="url" />
          </label>

          <button type="button">Run risk check</button>
        </form>
      </main>
    </>
  );
}
