# Automatic speech growth

Service Ears 3.2 improves language coverage without training a large acoustic model on
the waiter laptop. The shipped Whisper weights remain replaceable. The application
learns in smaller, auditable layers that are cheap to distribute and cannot silently
create POS products.

## Implemented now

- A POS-independent seed document expands into more than 1,000 acoustic aliases and
  more than 3,000 Dutch, English and French request forms.
- The speech ranker scores culinary knowledge separately from menu fit. A clearer
  out-of-menu phrase therefore does not lose merely because another hypothesis happens
  to name a menu product.
- Out-of-menu requests produce a blocking issue and active same-family alternatives.
  No alternative is ordered until the guest chooses and the waiter confirms it.
- Live Edge preview can be enabled explicitly. It renders transcript and provisional
  understanding while the person is speaking; local Whisper performs the final pass.
- Local recording can finish automatically after 2.8 seconds of silence.
- Three identical, conflict-free waiter corrections automatically promote a local
  pronunciation rule. Conflicting mappings remain pending for review.
- Audio is transient. Learned rules contain only a short normalized fragment and POS ID.

## Why arbitrary online listening is excluded

Public conversations are not automatically lawful, consented, correctly labelled or
representative training material. Unlabelled audio can reinforce transcription errors,
and indiscriminate capture would violate the product's privacy boundary. Service Ears
must ingest only data with a documented license or explicit speaker/restaurant consent.

Suitable external evaluation sources include Mozilla Common Voice, whose current
catalog publishes language/task/license metadata, and FLEURS, a parallel benchmark in
102 languages. They are useful for coverage evaluation but do not replace restaurant
audio with Belgian dialect, table noise, code-switching and real menu terminology.

- https://commonvoice.mozilla.org/data
- https://arxiv.org/abs/2205.12446
- https://cdn.openai.com/papers/whisper.pdf

## Off-device training pipeline for a pilot

1. Collect explicit consent and a retention period before recording pilot audio.
2. Strip table, guest and waiter identifiers; keep random session IDs only.
3. Reject clipped, silent, overlapping or music-dominant segments automatically.
4. Produce candidate transcripts with at least two independent ASR engines.
5. Accept pseudo-labels only when engines agree and menu/culinary context is consistent.
6. Sample every accent/language/noise group for human audit; never trust only an
   aggregate word-error rate.
7. Split by speaker and restaurant before training to prevent identity leakage.
8. Fine-tune or distil on a GPU worker, not on service laptops.
9. Gate every candidate model on word error, product recall, false-product rate,
   negation/removal accuracy, question accuracy and latency per device class.
10. Convert a passing candidate into an optional model pack and roll it out gradually.
11. Keep the previous pack available for immediate rollback.

OpenAI's current realtime transcription documentation describes streaming audio chunks
and transcript deltas, but the corresponding realtime model is metered and does not
support fine-tuning. It is therefore an optional future provider, not a hidden
dependency of the free local build.

- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.openai.com/api/docs/models/gpt-realtime-whisper

## Acceptance rule

A larger vocabulary count is not proof of accuracy. A model or language pack is
promoted only if held-out real audio improves the safety metrics without increasing
false POS additions. The waiter remains the final authority for every substitute,
allergy and uncertain match.
