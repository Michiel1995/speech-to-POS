# Product

Service Ears is a voice input layer in front of an existing hospitality POS. It is
not a POS, waiter replacement, payment product, or restaurant-management suite.

## Product contract

1. The waiter selects a table and listens to the real conversation.
2. Speech is separated into speaker-labelled turns where possible.
3. Conversation intent is reduced to the final confirmed order.
4. Spoken concepts are mapped to active POS product and modifier IDs.
5. Deterministic validation exposes ambiguity, unknown items, required options,
   allergies, and unusual course timing.
6. The waiter resolves only those exceptions.
7. The product creates a POS **draft** only when the adapter supports a safe draft
   state. The waiter confirms in the existing POS.

The rule is permanent: **AI prepares; human confirms; POS executes.**

## MVP roles

- **Waiter:** choose table, capture, resolve, correct, send, and recover unsent work.
- **Manager:** review restaurant mappings and repeated correction proposals. The
  approval engine exists; the full manager screen is a post-MVP item.

The application is tenant-aware but seeded for one fictional Belgian pilot. It does
not score employees.

## Implemented experience

- Table and shift controls, microphone and text capture, six built-in demos.
- Course-grouped draft review with real POS names/SKUs visible.
- Equal-weight ambiguity choices (maximum five), unknown-item manual resolution,
  missing modifier choices, allergy warning, course exception confirmation.
- Tap or voice correction and an offline cached-menu manual fallback.
- Explicit NOT_SENT, SENT, and ERROR states with idempotent mock submission.

## Deliberately absent

Payments, billing, inventory, full table management, reservations, reporting,
kitchen sequencing, discounts, employee analytics, and final POS confirmation.
