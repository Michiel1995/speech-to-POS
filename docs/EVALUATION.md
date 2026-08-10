# Evaluation

`evals/conversations.ts` contains **58** hand-authored hospitality cases. It covers
simple drinks, quantities, corrections, cancellations, multiple speakers, waiter
confirmation, questions, Dutch/English/French code switching, Belgian dialect,
ambiguity, duplicate POS entries, required modifiers, allergies, notes, course
changes, historical references, composite items, noise, and person/shared context.

## Separation

- **38 deterministic cases** run on every test invocation and compare exact product
  IDs, quantities, modifier IDs, issue types, and warning types.
- The remaining cases describe AI/audio-dependent expectations and known capability
  gaps. They are intentionally not counted as passing without real provider results.
- Unit tests separately cover validation, idempotency, correction-learning thresholds,
  strict accuracy calculation, and speaker-role conservatism.

## Pilot metric

A line is strictly correct only when product, quantity, modifier set, course, and
operational notes all match. `calculateQualityMetrics` also reports product, quantity,
and modifier accuracy separately. Target `>=97%` applies to a representative labelled
pilot set—not the deterministic rules-only subset.

Also capture corrections/order, false uncertainty, latency, POS submission success,
and time saved per shift. Do not compute employee rankings.

## Current result

The repository’s automated suite passes all deterministic expectations. This is code
verification, not a claim of 97% real-world voice accuracy. No noisy-restaurant audio
set or live Lightspeed account was available, so those risks remain unmeasured.
