# Voice pipeline

## MVP path

1. Browser `MediaRecorder` captures a manually bounded interaction over HTTPS.
2. The blob is posted to the server and never written to application storage.
3. `gpt-4o-transcribe-diarize` requests `diarized_json`, producing timestamped
   speaker segments. The current [OpenAI Audio API reference](https://developers.openai.com/api/reference/resources/audio)
   documents this speaker-labelled response format.
4. Conservative phrase markers identify a likely waiter speaker. Without evidence,
   roles stay `unknown`; the system does not fabricate identity.
5. `gpt-5.4-mini` uses structured output to reduce the conversation to final confirmed
   item concepts. Its [official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
   lists Structured Outputs support.
6. The deterministic menu layer maps concepts to POS IDs and blocks uncertainty.

The two-stage design is intentional: the realtime/audio model layer does not itself
provide strict structured outputs, so POS-safe extraction is isolated. OpenAI’s
[GPT-Realtime documentation](https://developers.openai.com/api/docs/models/gpt-realtime)
also confirms WebRTC/WebSocket/SIP support for a future streaming implementation.

## Current limitations

- Audio calls are **implemented but unverified** without an API key.
- MVP audio is near-real-time after manual stop, not continuous background shift
  streaming. Shift mode is a user-experience scaffold with manual control.
- Diarization labels speakers; it does not reliably determine waiter identity in every
  noisy restaurant. Optional biometric voice profiles are not implemented.
- Nearby speech, overlap, Belgian accents, and music require field measurements.

## Upgrade path

Move capture to Realtime WebRTC with server-created ephemeral sessions, semantic VAD,
and rolling provisional state. Keep final post-interaction structured extraction and
deterministic validation unchanged. Wearables implement `AudioInput`; they do not
change the order or POS layers.
