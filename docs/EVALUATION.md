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
- `word-recognition-v3.test.ts` adds targeted noisy product forms, five-alternative
  ASR ranking, hard-negative stories and a generated **1,000-case phonetic mutation
  bank**. This is a repeatable regression bank, not a substitute for real recordings.
- `culinary-knowledge.test.ts` executes **600 spread multilingual request cases** plus
  safety cases for out-of-menu recognition, alternative guidance, active seasonal
  dishes, stories, and menu-hallucination resistance. The backing seed document
  expands to over 1,000 acoustic aliases and over 3,000 request forms.
- `transcribe-latency-route.test.ts` is a hard release contract: a confident,
  explicitly menu-grounded Edge hypothesis must reach a correct deterministic concept
  in under 2 seconds without starting Whisper; vague context must use local checking;
  and a timed-out vague/noisy result must return a no-guess error without mutation.

## Pilot metric

A line is strictly correct only when product, quantity, modifier set, course, and
operational notes all match. `calculateQualityMetrics` also reports product, quantity,
and modifier accuracy separately. `calculateRecognitionMetrics` reports word error
rate, product recall/precision, candidate coverage, false-product rate, confirmation
rate and high-confidence errors. Target `>=97%` applies to a representative labelled
pilot set—not the deterministic rules-only subset.

Also capture corrections/order, false uncertainty, latency, POS submission success,
and time saved per shift. Do not compute employee rankings.

The runtime gate is strict: provisional p95 must remain below 2,000 ms and final p95
below 5,000 ms. Speed never lowers the factuality threshold. Product ambiguity,
quantity uncertainty, required modifiers, removals and low-evidence audio remain
blocking confirmation states rather than fast guesses.

## Current result

The repository’s automated suite passes all deterministic expectations. This is code
verification, not a claim of 97% real-world voice accuracy. No noisy-restaurant audio
set or live Lightspeed account was available, so those risks remain unmeasured.
