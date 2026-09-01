# Architecture

The product is a TypeScript modular monolith built with Next.js. One deployment owns
the phone UI, server routes, order engine, provider boundaries, and adapter registry.
There are no microservices or Kubernetes.

```text
Browser microphone / text / future wearable
                    │
             ephemeral audio
                    ▼
          speech + speaker boundary
                    │ labelled turns
                    ▼
       conversation extraction boundary
                    │ spoken concepts only
                    ▼
 semantic menu matching + deterministic validation
                    │ real POS IDs only
                    ▼
       minimal resolution UI → POSAdapter
                    │
        mock draft OR safe vendor draft
```

## Module boundaries

- `src/audio`: hardware-neutral capture contracts.
- `src/speech` and `src/speaker`: bundled whisper.cpp transcription, adaptive model
  selection/load control and conservative linguistic role inference.
- `src/order-understanding`: deterministic multilingual conversation engine.
- `src/semantic-menu`: normalized aliases and unbiased candidate matching.
- `src/validation`: final source-of-truth checks.
- `src/pos`: adapter contract, mock implementation, and Lightspeed implementation.
- `src/learning`: anonymized correction signals and manager-approved proposals.
- `src/analytics`: strict product-quality metrics.
- `app`: local API routes plus the desktop companion.

## Trust boundaries

Local transcript results are untrusted input. They are parsed into a Zod schema and
then remapped to the current menu. The POS adapter validates again.
Prices, product IDs, modifier IDs, active status, and allowed combinations never come
from model prose.

## Tenancy and persistence

Menu, draft, correction, and submission objects carry a `tenantId`. The MVP mock
adapter is memory-backed, while the browser stores only menu, selected table, and the
POS-relevant draft. A production pilot needs a tenant-scoped database and encrypted
server-side unsent-draft store; its schema can follow the current contracts without
changing the order engine.

## Reliability

The idempotency key is stable per draft. A failed send becomes ERROR and never loops.
Reconnection never submits automatically. The service worker and local menu/draft
cache keep the already-loaded manual fallback available.

The local model file is not part of the order engine contract. Deployments can add or
remove compatible whisper.cpp `.bin` model packs without rebuilding the app. The
runtime discovers them, selects the highest quality eligible tier, watches latency and
failures, and falls back. This keeps one application build usable across mixed laptop
fleets.
