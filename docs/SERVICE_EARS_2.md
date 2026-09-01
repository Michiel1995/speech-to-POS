# Service Ears 2.0 — implementation and QA handoff

## Implemented architecture

- A central 14-intent router separates orders, additions, removals, replacements, corrections, five question types, answers, refusals, non-order speech and unclear intent.
- A Flemish normalization layer supports automatic, standard, West-Flemish, East-Flemish, Antwerp, Brabant and Limburg profiles.
- The semantic product index combines canonical/POS names, SKU, optional brand/type/variant/size, commercial aliases, regional aliases, phonetic aliases and automatically generated pronunciation variants. Out-of-stock and inactive products are not orderable.
- Each table stores a bounded structured event log, its draft and current product context. No raw audio or full transcript is retained by default.
- Every interpreted segment becomes an explicit safe action. Recent utterance IDs provide idempotency, and draft snapshots provide undo/redo.
- Menu answers, prices, availability, registered allergens and conservative recommendations come only from the current POS menu.
- Local language mappings remain restaurant-local, store only a short phrase and product ID, and become active only after explicit approval. They can be imported, exported or deleted.

## User interface

The interface now presents three states: Listening, Understanding and Checking. Shift mode hides demo controls, a microphone meter and calibration status are visible, only one uncertainty is resolved at a time, older events are collapsible, and intent/confidence chips explain the latest interpretation. Taalbeheer is isolated in its own dialog.

## Safety controls

- Only active POS menu products/modifiers can enter a draft.
- Questions, jokes and stories do not mutate the draft.
- Fuzzy audio matches create a blocking confirmation.
- Empty drafts and drafts with blocking issues fail server-side validation.
- POS submission remains a waiter-confirmed draft action with an idempotency key.
- Per-table storage keys prevent cross-table context sharing.
- Raw recording buffers are temporary and released after processing.

## Verification baseline — 2026-08-11

- TypeScript: passed.
- ESLint with zero warnings: passed.
- Vitest: 249/249 passed across eight files.
- Dedicated intent cases: 114 passed.
- Mandatory acceptance scenarios: 20/20 passed.
- Labeled deterministic conversation corpus: 38/38 passed; 20 harder audio/association cases remain marked non-deterministic research cases.
- Production Next.js build: passed.
- Exact browser output runtime: passed question, addition, removal, fuzzy matching, context, joke filtering and mock-POS tests.
- Exact local portable runtime: offline Whisper and Silero VAD active; test audio transcribed without an API key and resolved to steak + fries + pepper sauce + 2 Duvel.
- Visible in-app browser flow: passed with zero console errors; test data and learned alias removed afterwards.
- Package SHA-256 verification: all listed critical files passed.

The metric implementation in `src/analytics/evaluation-metrics.ts` reports question-intent accuracy, product precision/recall, exact-order match, false-order rate, false-removal rate, clarification rate, average latency, dialect accuracy and product confusion matrices. The false-order metric is kept separate and is the primary safety metric.

## Known limitations

- Browser fallback recognition is processed by Microsoft Edge and therefore needs internet; use the local portable package for a fully offline test.
- Local Whisper cannot guarantee perfect recognition in arbitrary noise, dialect or overlapping speech. The app deliberately asks for confirmation when confidence is insufficient.
- Speaker diarization and robust multi-speaker overlap separation are not complete; overlap is currently detected as a warning rather than separated into independently attributed speakers.
- Ingredient answers are limited to the allergen/ingredient metadata actually provided by the POS.
- The supplied model is Whisper Small Q5_1. Larger models can improve accuracy but require additional memory and are not bundled because of package size.
- No new signed installer was shipped. Smart App Control previously blocked the unsigned installer, so the required browser and portable folders remain the reliable handoff.
