# Voice pipeline

## Offline prototype path

1. Shift start measures the ambient noise floor while the waiter stays quiet. The
   renderer captures mono PCM and an adaptive detector finishes after roughly
   1.6–1.9 seconds below the speech-over-noise threshold.
2. When explicitly enabled, Microsoft Edge supplies provisional transcript deltas
   while the guest speaks. A debounced localhost interpretation renders a complete
   provisional concept (quantities and modifiers included) without mutating stored
   order state. Disabling the option keeps the entire path local.
3. The renderer downsamples to 16 kHz, high-pass filters low-frequency rumble, trims
   non-speech before/after the utterance, applies bounded normalization, and encodes a
   16-bit WAV in memory. Pauses inside the utterance remain intact.
4. The WAV is posted only to the app's server on `127.0.0.1`.
5. Bundled Silero VAD isolates speech from silence and background noise. Its threshold,
   minimum speech duration, silence split and padding adapt to measured quietness and clipping before
   bundled whisper.cpp v1.9.1 and the installed multilingual models transcribe locally.
   The adaptive package starts with Small Q5 and escalates uncertain, weakly grounded
   results to Large-v3 Turbo Q5; the light package remains Small-only.
6. Current table context, ordered products, canonical menu names, POS names, aliases,
   and modifier pronunciations are prioritized inside the decoding prompt.
7. A persistent localhost-only whisper server keeps the selected model warm between
   utterances and unloads it after three idle minutes. Only one transcription runs at
   once, no more than two wait, and CPU use is capped to at most six threads in the
   portable build. The CLI remains an automatic process-level fallback.
8. The hard user-visible budgets are provisional Review p95 below 2 seconds and final
   Review p95 below 5 seconds. A final Edge hypothesis may skip Whisper only when it
   has strong acoustic confidence, an explicit active-menu match, a safe order intent,
   and a clear score margin. Otherwise local Small gets a 4.2-second pass budget.
   Exceeding that budget may use only the same strict menu-grounded fallback; vague or
   noisy speech returns `TRANSCRIPTION_BUDGET_EXCEEDED` and mutates nothing.
9. A shared hypothesis ranker combines acoustic confidence, phonetic distance,
   active-menu fit, current category, table history, existing order lines, dialogue
   intent and decoder-artifact penalties. The score margin remains available to the UI.
10. The deterministic multilingual engine maps the transcript to current mock-POS IDs.
   Unlisted fuzzy matches require an explicit yes/no confirmation; ambiguity, missing
   modifiers, and unusual timing remain blocking human-review issues.
11. A separate culinary knowledge layer recognizes known dishes outside the POS and
   proposes only active same-family alternatives as waiter guidance. Substitution is
   never automatic.
12. The temporary WAV and all JSON transcript candidates are removed after every request.

## Word recognition safeguards

- Exact menu names are evaluated before fuzzy spans, so quantities and words such as
  `met` or `nog` cannot be swallowed by a larger guessed product phrase.
- Weighted phonetics handle common Dutch/Flemish/French/English confusions, including
  v/f/w, b/p, d/t, s/z, c/k, vowel length, final-n loss and shortened syllables.
- Fuzzy candidates carry acoustic score, table/category/order bonuses, score margin
  and evidence. A non-exact audio match still requires explicit confirmation.
- Questions, stories, jokes, negations and waiter menu listings are routed before any
  POS mutation. Context can help rank a candidate but is capped and cannot create an
  order from an acoustically unrelated word.

The language selector defaults to Dutch and also supports French, English, or
automatic detection. A fixed language is preferable for short restaurant utterances.

## Current limitations

- The free local Whisper final pass still runs per completed turn rather than decoding
  PCM token-by-token. Opt-in Edge supplies live provisional deltas; automatic silence
  detection removes the need to press Stop for ordinary turns.
- The sub-two-second complete provisional concept requires the explicit Edge option
  and internet access. Fully local mode remains private but cannot honestly guarantee
  that latency on every CPU; it still enforces the five-second no-guess outcome budget.
- The local model uses linguistic waiter markers but does not perform biometric
  speaker identification or full acoustic diarization.
- Nearby speech, overlapping speakers, strong Belgian accents, music, and very unclear
  articulation still require field testing. No recognizer can guarantee every utterance.
- The bundled prototype targets Windows x64. Model eligibility considers installed
  RAM, currently free RAM and logical processors; it still needs validation on every
  intended device class.

## Possible pilot upgrade

Keep the same WAV, draft, validation, and POS boundaries while adding streaming capture,
larger local models, GPU acceleration, or an explicitly selected hosted provider.
Wearables should implement the audio-input boundary without changing order safety.
