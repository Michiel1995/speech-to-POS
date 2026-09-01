# POS adapter

`POSAdapter` exposes capabilities and four MVP operations:

```ts
getMenu(): Promise<TenantMenu>
getTables(): Promise<Table[]>
createDraftOrder(submission): Promise<DraftOrder>
getOrder(externalOrderId): Promise<unknown | null>
```

Capabilities are explicit (`menuRead`, `tableRead`, `openOrderRead`,
`draftOrderCreate`, `draftOrderUpdate`). UI and domain code must not infer support from
the vendor name.

## MockPOSAdapter — MOCKED

Provides the complete demo menu, tables, deterministic validation, stable
idempotency, and retrievable mock drafts. `SENT` means “present in mock POS as a draft”
and `confirmedByWaiter` remains false.

## LightspeedPOSAdapter — REAL READS / UNVERIFIED / DRAFT BLOCKED

Uses real HTTPS/Bearer calls for K-Series menu, production-instruction, table, and
open-check data when valid credentials are configured. Live account calls have not
been executed in this repository. Draft creation is unavailable for the safety reason
documented in `LIGHTSPEED.md`.

## Adding a POS

Implement the contract, map the vendor response into `TenantMenu`, declare capabilities
honestly, and pass the shared validator/idempotency tests. Never expose a live-order
endpoint as draft capability without vendor-confirmed semantics.
