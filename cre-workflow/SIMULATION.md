# Verified CRE simulation

Verified on 2026-10-02 with CRE CLI `v1.36.0`.

```bash
cre workflow simulate . \
  --target local-simulation \
  --http-payload http-trigger-payload.json
```

The authenticated simulation completed successfully with:

- Arc network: `arc-testnet` (`5042002`)
- CRE chain selector: `3034092155422581607`
- Workflow binary hash: `0438b1c303512e9d4c614aa06bc93e8f343b1a1f7507987f30584e0351a358e8`
- Config hash: `556bf56e0f9b2bdfd21dc9c3bcc51750b4a426cee15d3a084e83bc7b14f34623`
- Arc blocklist result: `true`
- RDAP status: `found`
- Final decision: `block`
- Reason code: `ARC_DENYLIST_MATCH`

```json
{
  "arcDenylisted": true,
  "decision": "block",
  "domainAgeDays": 11372,
  "hostname": "example.com",
  "localReasonCodes": [],
  "rdapStatus": "found",
  "reasonCodes": ["ARC_DENYLIST_MATCH"],
  "recipient": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "registeredAt": "1995-08-14T04:00:00Z",
  "ruleset": "arcshield-2026-09-21"
}
```

This was a read-only simulation. It did not deploy a workflow, write onchain,
move funds, or use a private wallet key.
