# Error Diagnostic Directory

This directory is meant to help future debugging move quickly. When a new failure appears, start here and then follow the exact file list for the affected phase.

## 1. Start by phase

### Startup
- Files: app/components/voice-order-console.tsx, src/ui/error-registry.ts, src/ui/voice-errors.ts
- Typical error codes: UNKNOWN, LOCAL_WHISPER_RUNTIME_UNAVAILABLE, MENU_LOAD_FAILED
- What to inspect: service readiness, hydration, and whether the app is in browser or desktop mode

### Microphone
- Files: app/components/voice-order-console.tsx, src/audio/endpointing.ts, src/audio/pcm-wav.ts
- Typical error codes: MICROPHONE_DENIED, MICROPHONE_STREAM_FAILED, NO_SPEECH_DETECTED, AUDIO_ONLY_NOISE
- What to inspect: getUserMedia, AudioContext, silence detection, ambient noise calibration

### Browser speech
- Files: app/components/voice-order-console.tsx, src/speech/browser-speech-policy.ts, src/speech/recognition-ranker.ts, src/speech/warmup-policy.ts
- Typical error codes: BROWSER_SPEECH_UNAVAILABLE, BROWSER_SPEECH_FAILED, BROWSER_SPEECH_NO_RESULT
- What to inspect: SpeechRecognition availability, onresult/onerror/onend flow, fallback logic

### Audio finalization
- Files: app/components/voice-order-console.tsx, src/audio/pcm-wav.ts, src/audio/audio-quality.ts
- Typical error codes: AUDIO_CHUNKS_EMPTY, AUDIO_SAMPLE_RATE_INVALID, AUDIO_WAV_HEADER_INVALID, WAV_CREATION_FAILED
- What to inspect: recordingChunks, sample-rate guard, WAV encoding, trimming, high-pass filtering

### Local transcription
- Files: app/components/voice-order-console.tsx, src/ui/voice-errors.ts, src/ui/error-registry.ts
- Typical error codes: LOCAL_TRANSCRIBE_API_FAILED, LOCAL_TRANSCRIBE_TIMEOUT, LOCAL_WHISPER_CLI_MISSING, LOCAL_WHISPER_MODEL_MISSING, LOCAL_WHISPER_RUNTIME_UNAVAILABLE, TRANSCRIPTION_BUDGET_EXCEEDED
- What to inspect: if the browser path still reaches /api/transcribe, runtime status, local model availability, queue/stall behavior

### Interpretation
- Files: app/components/voice-order-console.tsx, src/order-understanding/**, src/semantic-menu/**, src/ui/draft-actions.ts
- Typical error codes: INTERPRETATION_FAILED, INVALID_REQUEST
- What to inspect: transcript-to-order conversion, draft revision checks, menu grounding and route intent rules

### POS
- Files: src/ui/draft-actions.ts, src/pos/**, app/components/voice-order-console.tsx
- Typical error codes: POS_UNAVAILABLE
- What to inspect: final send path, read-back confirmation, adapter capability checks

## 2. How to use this when an issue appears

1. Look at the runtime text and identify phase.
2. Match the phase to the table above.
3. Open the exact files in that section.
4. Check the likely root causes and the explicit checks listed in src/ui/error-catalog.ts.
5. Add a precise code before widening the fix.

## 3. Rule of thumb

Do not patch the symptom first. Always follow this order:

1. classify the code
2. confirm the phase
3. inspect the exact files in that phase
4. fix the root cause
5. add a regression check

## 4. High-confidence files for the current stack

- Browser recording flow: app/components/voice-order-console.tsx
- Browser policy: src/speech/browser-speech-policy.ts
- Warmup policy: src/speech/warmup-policy.ts
- PCM/WAV assembly: src/audio/pcm-wav.ts
- Error taxonomy: src/ui/voice-errors.ts
- Structured incident registry: src/ui/error-registry.ts
- Long-form diagnostic catalog: src/ui/error-catalog.ts

This directory exists so future investigation can begin by narrowing to the right phase instead of hunting across the whole app.
