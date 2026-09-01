# Service Ears — AI voice layer for hospitality POS

Service Ears is a mobile-first voice input layer that turns a real waiter/customer
conversation into a validated **draft** made only from products and modifiers that
exist in the restaurant POS. AI prepares, the waiter resolves uncertainty, and the
existing POS remains the system of record.

The Windows desktop build includes multilingual Whisper speech recognition and a
complete mock-backed POS demo. Speech, transcript interpretation, corrections, and
mock submission run locally without an API key, subscription, or internet connection.

Service Ears 2.0 adds a 14-way intent router, configurable Flemish dialect profiles,
structured per-table event memory, idempotent utterance handling, undo/redo, menu
questions, local correction learning with manager approval, and a calmer three-phase UI.

The 3.0 recognition upgrade adds weighted multilingual phonetics, menu/category/table
candidate rescoring, five-hypothesis Edge ranking, wider local Whisper decoding,
adaptive Silero VAD, low-confidence rescue recognition, explainable score margins and
a generated 1,000-variant word-recognition regression bank.

Service Ears 3.1 makes the local speech model modular and adaptive. Capable laptops
use Large-v3 Turbo Q5 with Small Q5 as reserve; lighter devices stay on Small. A
single persistent local speech server avoids reloading the model for every utterance,
unloads it after inactivity, limits CPU threads, serializes transcription work, and
automatically demotes a model after failures or repeated excessive latency.

Service Ears 3.2 adds opt-in live Edge transcript deltas while local Whisper remains
the final authority, automatic end-of-turn processing after silence, cross-engine
hypothesis ranking, and a POS-independent culinary knowledge layer. More than 1,000
acoustic aliases and 3,000 multilingual request forms recognize unavailable dishes
without ever ordering a substitute. Repeated conflict-free corrections become local
language rules automatically; conflicting evidence remains reviewable.

Service Ears 3.5 calibrates the ambient noise floor at shift start, preloads the
fast local speech model while the shift starts, rejects empty/noise-only audio
before native processing, guards model-server startup failures, and uses adaptive
end-of-turn detection, trims terminal noise/silence in memory, and high-pass filters
low-frequency rumble. A sole offered-product follow-up now has a guarded low-latency
path in Dutch, English, and French; weak phonetic collisions such as `please` →
`Plaice` and `celle` → `Stella` are suppressed. Explicit waiter corrections become
local rules immediately when conflict-free.

## Quick start

For a ready-to-run test, use one of the generated output folders:

- `outputs/Service-Ears-3.5-Browsertest/Start-Service-Ears-Browsertest.cmd`
- `outputs/Service-Ears-3.5-Lokaal-Adaptief/Start-Service-Ears-Lokaal.cmd`
- `outputs/Service-Ears-3.5-Lokaal-Licht/Start-Service-Ears-Lokaal.cmd`

For source development:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, choose Table 12, load the core demo, and tap
**Interpret order**. For a phone on the same network, start with
`pnpm dev --hostname 0.0.0.0` and use the computer's LAN IP. Browser microphone
access outside localhost requires HTTPS; see [deployment](docs/DEPLOYMENT.md).

After a conversation is processed successfully, the transcript field is cleared
automatically. A later recording or typed addition therefore contains only the new
conversation and is added once to the table's existing draft. Switching tables or
starting a new order also clears unprocessed transcript text.

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
- Adaptive local Whisper Large-v3 Turbo Q5/Small Q5 transcription with Silero VAD: **implemented on Windows x64**
- Multi-hypothesis phonetic/menu/context rescoring and adaptive VAD: **implemented**
- Blocking yes/no confirmation for uncertain fuzzy audio matches: **implemented**
- 886 intent, culinary-language, conversation, safety, memory, audio and recognition tests: **passing**
- Fully local portable browser runtime with checksums and license notices: **implemented and runtime-tested**
- Local deterministic order interpretation: **implemented and credential-free**
- Lightspeed menu/table/open-check reads: **implemented, unverified without
  credentials**
- Lightspeed parked/draft creation: **blocked by API capability** — current public
  K-Series documentation exposes live Local Order creation, not a documented parked
  draft state, so the adapter refuses unsafe submission.

See [the Service Ears 2.0 handoff](docs/SERVICE_EARS_2.md), [the product guide](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), and
[pilot roadmap](docs/ROADMAP.md) for the practical status and next steps. The
[Recognition 1000 execution map](docs/RECOGNITION_1000_EXECUTION.md) separates the
implemented software foundations from work that requires real restaurant audio or
physical microphone testing.
