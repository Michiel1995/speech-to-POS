# Service Ears — AI voice layer for hospitality POS

Service Ears is a mobile-first voice input layer that turns a real waiter/customer
conversation into a validated **draft** made only from products and modifiers that
exist in the restaurant POS. AI prepares, the waiter resolves uncertainty, and the
existing POS remains the system of record.

The repository currently ships a complete mock-backed demo and safe provider
boundaries for OpenAI and Lightspeed Restaurant K-Series. Start with the mock demo;
it requires no credentials.

## Quick start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, choose Table 12, load the core demo, and tap
**Interpret order**. For a phone on the same network, start with
`pnpm dev --hostname 0.0.0.0` and use the computer's LAN IP. Browser microphone
access outside localhost requires HTTPS; see [deployment](docs/DEPLOYMENT.md).

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Integration status

- Mock POS draft flow: **implemented**
- Deterministic multilingual demo engine: **implemented**
- OpenAI diarized transcription and structured interpretation: **implemented,
  unverified without credentials**
- Lightspeed menu/table/open-check reads: **implemented, unverified without
  credentials**
- Lightspeed parked/draft creation: **blocked by API capability** — current public
  K-Series documentation exposes live Local Order creation, not a documented parked
  draft state, so the adapter refuses unsafe submission.

See [the product guide](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), and
[pilot roadmap](docs/ROADMAP.md) for the practical status and next steps.
