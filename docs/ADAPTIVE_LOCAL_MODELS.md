# Adaptive local speech models

Service Ears 3.1 separates the application from its local Whisper model. Every
compatible `.bin` file in `offline-speech/models` is discovered at runtime. This
allows one codebase and order engine to run with different model packs per device.

## Default tiers

| Tier | Intended device | Role |
| --- | --- | --- |
| Large-v3 Turbo Q5 | About 16 GB RAM and a modern multi-core CPU | Highest local prototype accuracy |
| Small Q5 | About 8 GB RAM and a modest multi-core CPU | Portable reserve and light rollout |

The decision also uses currently free memory. If no installed model fits safely, the
request is refused instead of forcing a model into memory.

## Load controls

- At most six processor threads in the shipped Windows launcher.
- One active transcription and at most two queued requests.
- Below-normal process priority in the portable launcher.
- Persistent localhost-only inference server to avoid repeated model loads.
- Automatic unload after three idle minutes.
- Automatic temporary demotion after a failure or repeated excessive latency.
- CLI process fallback if the persistent server cannot start.

## Rollout

Ship the Light package to unknown hardware first. Add the Large-v3 Turbo model pack
only after a device-class benchmark passes. Removing that large `.bin` file returns
the same app to Small automatically; no rebuild or database migration is required.

The model improves acoustic recognition but does not learn a restaurant dialect by
itself. Sustainable improvement still depends on consented, anonymized field audio,
expected transcripts, correction-rate metrics and regression evaluation before a new
model or vocabulary pack is promoted.
