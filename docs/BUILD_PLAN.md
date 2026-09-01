# Build Plan

## Goal

Build a deployable, mobile-first AI voice input layer that converts hospitality
conversations into validated POS draft orders. The existing POS remains the system
of record: AI prepares, a waiter resolves uncertainty, and the waiter confirms in
the POS.

## Repository state

The repository contained only an initial README when implementation started on
2026-08-10. The README is preserved and expanded.

## MVP vertical slice

1. A realistic, messy Belgian menu exposed by a tenant-aware mock POS adapter.
2. Typed semantic menu, conversation, order, ambiguity, validation, and submission
   contracts.
3. Deterministic text interpretation for the core demos: questions, confirmations,
   corrections, cancellations, quantities, aliases, modifiers, courses, allergies,
   ambiguity, and unknown products.
4. Server-side OpenAI boundaries for structured interpretation and diarized
   transcription, while demo mode works without credentials.
5. A minimal mobile companion for table selection, capture, review, uncertainty
   resolution, voice correction, and explicit draft submission.
6. Idempotent mock POS submission with NOT_SENT, SENT, and ERROR states.
7. Offline local draft persistence; reconnection never auto-submits.
8. A capability-driven Lightspeed K-Series adapter with honest safety limits.
9. Deterministic tests plus a separate corpus of at least 50 realistic conversations.
10. Deployment configuration and practical documentation.

## Architecture

Use a TypeScript/Next.js modular monolith. Domain logic remains independent of UI,
audio devices, AI providers, and POS vendors. Server routes own credentials.

- `src/audio/`: replaceable capture contracts
- `src/speech/`: transcription provider boundary
- `src/speaker/`: speaker-labelled turn contracts
- `src/order-understanding/`: intent and conversational state
- `src/semantic-menu/`: canonical-to-POS mapping
- `src/validation/`: deterministic source-of-truth checks
- `src/pos/`: capability-based adapters
- `src/lightspeed/`: K-Series HTTP boundary
- `src/learning/`: correction signals
- `src/analytics/`: aggregate product-quality metrics
- `app/`: mobile UI and server endpoints

No model output reaches a POS adapter before schema and deterministic menu
validation.

## Safety rules

- Only active product and modifier IDs from the current menu can be submitted.
- Ambiguous, unresolved, or incomplete lines block submission.
- Submission requires an explicit waiter action and idempotency key.
- Raw audio and transcripts are transient by default.
- Allergy statements create a manual-check warning, never a safety claim.
- Tenant ID exists on menu, draft, correction, and submission records.
- No employee scoring is implemented.

## Assumptions

- One fictional Belgian pilot restaurant is seeded; data structures remain tenant
  aware.
- The mock adapter is the default and supports the full demo.
- Production Lightspeed is not "real" until OAuth credentials and the restaurant's
  exact K-Series configuration are tested.
- Current public K-Series docs expose live Local Order creation but no documented
  parked/draft state. The real adapter therefore refuses draft creation.
- Browser microphone access requires HTTPS outside localhost.
- Diarization is provider-dependent and remains a field-testing risk.
- Hosted account credentials are unavailable during build, so deployment is fully
  prepared even if no live URL can be provisioned.

## Definition of done

- The core demo yields one steak with cuisson, fries, and pepper sauce; one
  vol-au-vent with croquettes; one Duvel; and one Stella without waiter-repeat
  duplication.
- “Een Leffe” produces unbiased valid choices.
- Unknown products remain unresolved; menu questions create no order.
- Mixed-language modifiers map to valid POS IDs.
- Required modifiers and course exceptions are explicit.
- Mock draft submission is explicit and idempotent.
- Tests, lint, typecheck, and production build pass.
- Documentation distinguishes implemented, mocked, unverified, and blocked paths.
