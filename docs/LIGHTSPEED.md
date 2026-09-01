# Lightspeed Restaurant K-Series

Status: **real read adapter implemented; unverified without credentials; safe draft
creation blocked by documented capability.**

## Why K-Series

Lightspeed has multiple Restaurant product families. This implementation targets the
current K-Series API only and isolates it behind `POSAdapter`; it does not assume that
L-Series or O-Series contracts are compatible.

Current official K-Series documentation establishes:

- OAuth2 authorization-code authentication and the `orders-api` scope for menu,
  floors, orders, and payments: [Authentication](https://api-docs.lsk.lightspeed.app/authentication).
- Menu listing and V2 menu loading, including product modifier information:
  [Get All Menus](https://api-docs.lsk.lightspeed.app/operation/operation-apeloadmenus)
  and [Get Single Menu](https://api-docs.lsk.lightspeed.app/operation/operation-apegetmenubyid).
- Production instructions/modifiers: [Get Modifiers](https://api-docs.lsk.lightspeed.app/operation/operation-apeloadallmodifiers).
- Floors and tables: [Get All Floorplans](https://api-docs.lsk.lightspeed.app/operation/operation-apelookupfloorplans).
- Current open checks: [Get All Open Checks](https://api-docs.lsk.lightspeed.app/operation/operation-apegetcheck).
- A dine-in **Create Local Order** operation:
  [official endpoint](https://api-docs.lsk.lightspeed.app/operation/operation-apelocalorder).

## Implemented calls

- Discover or load a configured menu.
- Load product names, SKUs, prices, rich allergen codes, and documented production
  instructions.
- Load floorplan tables.
- Read current open checks and find one by external ID.

Set `POS_ADAPTER=lightspeed` and provide the server-side variables in `.env.example`.
OAuth token acquisition/refresh belongs in the deployment’s encrypted credential
store; the MVP accepts an access token for controlled integration testing.

## Draft constraint

The public documentation describes Create Local Order as creating a dine-in order; it
does not document a parked, concept, or waiter-review draft flag. Calling that endpoint
could operationally place/print an order before the waiter confirms it. Therefore
`draftOrderCreate` is `false` and `createDraftOrder()` throws an explicit unsupported
capability error. The endpoint is not called.

Before a pilot, Lightspeed must confirm a supported native draft/parked workflow or a
partner-specific capability. If none exists, product UX must choose a separately
approved nearest equivalent; the system will not silently reinterpret a live order as
a draft.
