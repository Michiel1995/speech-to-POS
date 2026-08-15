# Recognition 1000 execution map

The 1,000-point recognition backlog is treated as an engineering programme, not as
1,000 unrelated aliases. This release implements the shared foundations that make the
individual variants executable and measurable.

## Implemented in 0.3.0

- Weighted multilingual phonetics for consonant families, vowel variation, final
  consonants, final-n loss, doubled letters, compact compounds and shortened syllables.
- Candidate records with acoustic score, table-context bonus, existing-order bonus,
  category bonus, evidence, runner-up margin and mandatory confirmation state.
- Exact-first span resolution plus safe expansion around an exact subphrase. Quantity,
  intent, determiner, conjunction and modifier words cannot be swallowed by expansion.
- Five-alternative Edge ranking with acoustic, menu, context, intent, language and
  decoder-artifact components.
- Wider whisper.cpp beam/best-of decoding, prompt carry, word-aware splitting, three
  VAD profiles, context retry, severe-failure rescue and up to five retained hypotheses.
- Per-table persistent product context, prior-order preference, non-destructive
  additions, stable deduplication, unique line IDs, undo/redo and context follow-ups.
- Broader Flemish contractions and regional profiles, multilingual quantities and
  polite-order/question separation.
- Explainable confirmation UI and correction evidence collection. Repeated mappings
  remain pending until a manager approves them.
- Separate recognition metrics for WER, product recall/precision, candidate coverage,
  false-product rate, confirmation rate and high-confidence errors.
- A generated 1,000-case phonetic mutation regression bank plus hard-negative stories,
  noisy product forms and ASR alternative-ranking tests.

## Configuration exposed by the architecture

Restaurant menus already carry canonical names, POS names, brand, product type,
variant, size, regional aliases and phonetic aliases. Changes are reflected in prompts
and matching without editing recognition code. VAD, model paths and thread count remain
deployment configuration.

## Requires pilot recordings or physical work

The following backlog items cannot be truthfully completed using source code alone:

- selecting and positioning the restaurant's actual microphone;
- measuring real signal-to-noise ratio, reverberation and speaker distance;
- collecting consented audio from different regions, ages and speech conditions;
- learning restaurant-specific error frequencies and approving proposed aliases;
- benchmarking larger models or GPU acceleration on the target laptop;
- setting final product-specific thresholds from labelled pilot outcomes.

Use real recordings only with an agreed privacy policy. Add confirmed failures to the
regression corpus, compare the metrics before and after every change, and roll back any
release that raises false additions or false removals.
