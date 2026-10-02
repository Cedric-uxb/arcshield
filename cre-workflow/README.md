# ArcShield CRE workflow

This Chainlink CRE simulation accepts ArcShield's local evidence, reads the Arc
mainnet USDC denylist contract, fetches public RDAP registration data for the
submitted hostname, and returns an explainable `allow`, `review`, or `block`
decision. It never writes to a blockchain or moves funds.

The workflow sends only the hostname, not the full payment URL, to the public
RDAP service. RDAP availability and registration dates are evidence inputs, not
proof that a domain or payment is safe.

## Run

Prerequisites: Bun, CRE CLI `v1.36.0` or later, and a logged-in CRE account.

```bash
bun install
bun test
bun run typecheck
cre workflow simulate . \
  --target local-simulation \
  --http-payload http-trigger-payload.json
```

The simulation must show both the Arc contract read and RDAP request before the
result is used as bounty evidence.
