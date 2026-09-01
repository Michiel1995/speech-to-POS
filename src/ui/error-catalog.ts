export type ErrorPhaseKey =
  | "startup"
  | "menu"
  | "microphone"
  | "browser-speech"
  | "audio-finalization"
  | "transcription"
  | "interpretation"
  | "pos"
  | "unknown";

export interface ErrorCatalogEntry {
  code: string;
  phase: ErrorPhaseKey;
  component: string;
  summary: string;
  likelyRootCauses: string[];
  filesToInspect: string[];
  checks: string[];
  retryable: boolean;
  nextStep: string;
}

export const ERROR_CATALOG: Record<string, ErrorCatalogEntry> = {
  UNKNOWN: {
    code: "UNKNOWN",
    phase: "unknown",
    component: "General diagnostic layer",
    summary: "No precise match was found for the failure signature.",
    likelyRootCauses: [
      "Classifier missed a specific runtime message",
      "A new browser or OS error string appears",
      "The same runtime error reached multiple layers"
    ],
    filesToInspect: [
      "src/ui/voice-errors.ts",
      "src/ui/error-registry.ts",
      "app/components/voice-order-console.tsx"
    ],
    checks: [
      "Compare the raw message with known error strings",
      "Look for a missing classifier pattern",
      "Add the exact message and a matching code to the catalog"
    ],
    retryable: true,
    nextStep: "Add a new rule in classifyVoicePipelineError and confirm it maps to the correct phase."
  },
  MICROPHONE_DENIED: {
    code: "MICROPHONE_DENIED",
    phase: "microphone",
    component: "Microphone capture",
    summary: "The browser or OS denied microphone access or the stream never became usable.",
    likelyRootCauses: [
      "Permission prompt was rejected",
      "The selected input device is unavailable",
      "Windows privacy already blocked access"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/ui/voice-errors.ts",
      "src/ui/error-registry.ts"
    ],
    checks: [
      "Verify browser permission prompt and OS access",
      "Confirm the microphone device is active in the OS",
      "Check whether startLocalRecording or startBrowserRecording exits early"
    ],
    retryable: true,
    nextStep: "Confirm the permission flow and the fallback behavior when permission is denied."
  },
  MICROPHONE_STREAM_FAILED: {
    code: "MICROPHONE_STREAM_FAILED",
    phase: "microphone",
    component: "Microphone stream startup",
    summary: "getUserMedia succeeded, but no stable audio stream was created or remained usable.",
    likelyRootCauses: [
      "The browser blocked the stream",
      "An existing stream lock persisted",
      "The audio pipeline was disconnected before capture started"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/audio/endpointing.ts",
      "src/ui/error-registry.ts"
    ],
    checks: [
      "Check getUserMedia call site and error handling",
      "Verify stream tracks are not already in use",
      "Inspect whether audioContext and ScriptProcessor are created safely"
    ],
    retryable: true,
    nextStep: "Trace the flow from startRecording to startLocalRecording and confirm track lifecycle."
  },
  NO_SPEECH_DETECTED: {
    code: "NO_SPEECH_DETECTED",
    phase: "microphone",
    component: "Voice quality gate",
    summary: "The audio was too quiet or too brief to be considered a usable utterance.",
    likelyRootCauses: [
      "User spoke too softly",
      "The recording ended before speech began",
      "Noise floor was treated as a valid speech signal"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/audio/pcm-wav.ts",
      "src/audio/endpointing.ts"
    ],
    checks: [
      "Compare heardVoice.current against actual audio RMS values",
      "Check silenceTimer and automaticSilenceDelaySeconds",
      "Validate the speech threshold and frame-level detection logic"
    ],
    retryable: true,
    nextStep: "Inspect the threshold logic and make sure the speech gate is not rejecting valid short phrases."
  },
  AUDIO_ONLY_NOISE: {
    code: "AUDIO_ONLY_NOISE",
    phase: "audio-finalization",
    component: "Noise filtering",
    summary: "The recording passed capture but was classified as environment noise rather than speech.",
    likelyRootCauses: [
      "Noise floor calibration was too high",
      "Room noise dominated the capture",
      "Speech segments were shorter than the minimum cluster threshold"
    ],
    filesToInspect: [
      "src/audio/pcm-wav.ts",
      "app/components/voice-order-console.tsx",
      "src/audio/audio-quality.ts"
    ],
    checks: [
      "Verify meaningfulSpeechClusters logic",
      "Check calibration and ambientNoiseFloor values",
      "Validate that a short but valid command is still above threshold"
    ],
    retryable: true,
    nextStep: "Lower the speech threshold carefully or tune the cluster minimums for realistic hospitality speech."
  },
  AUDIO_CHUNKS_EMPTY: {
    code: "AUDIO_CHUNKS_EMPTY",
    phase: "audio-finalization",
    component: "Audio buffer assembly",
    summary: "No meaningful PCM chunk data was accumulated for encoding.",
    likelyRootCauses: [
      "The audio processing callback never fired",
      "The capture loop reset the buffer too soon",
      "The stream closed before data arrived"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/audio/pcm-wav.ts"
    ],
    checks: [
      "Confirm recordingChunks.current is being appended in onaudioprocess",
      "Check whether stopRecording is firing before first samples arrive",
      "Verify stream closure timing and reset order"
    ],
    retryable: true,
    nextStep: "Instrument the audio processing callback and verify chunk growth before finalization."
  },
  AUDIO_SAMPLE_RATE_INVALID: {
    code: "AUDIO_SAMPLE_RATE_INVALID",
    phase: "audio-finalization",
    component: "PCM preparation",
    summary: "The recorded sample rate was invalid or below the minimum required for local transcription.",
    likelyRootCauses: [
      "AudioContext sample rate is lower than expected",
      "The source stream is not in a normal browser format",
      "The captured data is being passed through a corrupted audio path"
    ],
    filesToInspect: [
      "src/audio/pcm-wav.ts",
      "app/components/voice-order-console.tsx"
    ],
    checks: [
      "Inspect recordingSampleRate.current at stopRecording",
      "Confirm the browser is using a standard audio source",
      "Check the input sample-rate guard in downsamplePcm"
    ],
    retryable: true,
    nextStep: "Validate the actual runtime sample rate and the guard conditions in the PCM helper."
  },
  AUDIO_WAV_HEADER_INVALID: {
    code: "AUDIO_WAV_HEADER_INVALID",
    phase: "audio-finalization",
    component: "WAV encoding",
    summary: "The output file was not a valid PCM WAV container or the header structure was malformed.",
    likelyRootCauses: [
      "Encoding was interrupted",
      "The buffer was not fully written",
      "The helper produced an incomplete output file"
    ],
    filesToInspect: [
      "src/audio/pcm-wav.ts",
      "app/components/voice-order-console.tsx"
    ],
    checks: [
      "Inspect encodePcm16Wav and the written byte offsets",
      "Verify the file size and RIFF header structure",
      "Confirm that writeText and setUint32 are writing complete data"
    ],
    retryable: true,
    nextStep: "Add a test for a valid WAV blob and then validate the byte layout against a known-good sample."
  },
  WAV_CREATION_FAILED: {
    code: "WAV_CREATION_FAILED",
    phase: "audio-finalization",
    component: "WAV assembly",
    summary: "The app prepared PCM but the final WAV blob generation crashed or returned unusable audio.",
    likelyRootCauses: [
      "preparedRecordingToWav threw while assembling the data",
      "A downstream helper rejected the prepared buffer",
      "The trimmed recording became empty after pre-processing"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/audio/pcm-wav.ts"
    ],
    checks: [
      "Check try-catch around preparedRecordingToWav",
      "Validate the trimmed samples length before encoding",
      "Verify the gain and speech detection stages did not strip all audio"
    ],
    retryable: true,
    nextStep: "Capture the exact thrown message and map it to the proper technical code with a dedicated classifier."
  },
  BROWSER_SPEECH_UNAVAILABLE: {
    code: "BROWSER_SPEECH_UNAVAILABLE",
    phase: "browser-speech",
    component: "SpeechRecognition availability",
    summary: "The browser does not expose a compatible SpeechRecognition implementation.",
    likelyRootCauses: [
      "Unsupported browser",
      "Recognition API missing in this runtime",
      "The fallback logic never reached the local route"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/speech/browser-speech-policy.ts",
      "src/speech/warmup-policy.ts"
    ],
    checks: [
      "Verify BrowserRecognition detection in hydration",
      "Check if the app still assumes browser mode on unsupported browsers",
      "Confirm the fallback to local startLocalRecording is enabled"
    ],
    retryable: false,
    nextStep: "Ensure the runtime chooses a supported browser path or falls back to local capture without blocking the user."
  },
  BROWSER_SPEECH_FAILED: {
    code: "BROWSER_SPEECH_FAILED",
    phase: "browser-speech",
    component: "Recognition runtime",
    summary: "Recognition started but failed before returning a trustworthy transcript.",
    likelyRootCauses: [
      "The API emitted a no-speech or network error",
      "Microphone permission was dropped mid-session",
      "Recognition ended before final text was produced"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/speech/browser-speech-policy.ts",
      "src/speech/recognition-ranker.ts"
    ],
    checks: [
      "Review recognition.onerror and recognition.onend handlers",
      "Check whether browserRecognitionFailed.current is used properly",
      "Confirm the fallback decision is based on the real event error"
    ],
    retryable: true,
    nextStep: "Trace the sequence of onresult, onerror, and onend to pin down whether the failure is user-side or runtime-side."
  },
  BROWSER_SPEECH_NO_RESULT: {
    code: "BROWSER_SPEECH_NO_RESULT",
    phase: "browser-speech",
    component: "Result selection",
    summary: "The browser produced no usable final transcript even though recognition ran.",
    likelyRootCauses: [
      "The speech result was empty after trimming",
      "All hypotheses were suppressed because they failed menu grounding",
      "The interim text was unreliable and final text never arrived"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/speech/recognition-ranker.ts",
      "src/speech/browser-speech-policy.ts"
    ],
    checks: [
      "Inspect completedBrowserSpeechText and bestSpeechAlternative",
      "Check final-vs-interim handling in recognition.onresult",
      "Verify that the app does not ignore browser text when it exists"
    ],
    retryable: true,
    nextStep: "Choose the final text source carefully and avoid suppressing valid browser results before interpretation."
  },
  LOCAL_TRANSCRIBE_API_FAILED: {
    code: "LOCAL_TRANSCRIBE_API_FAILED",
    phase: "transcription",
    component: "Local /api/transcribe route",
    summary: "The local transcription endpoint responded with a server failure or operational problem.",
    likelyRootCauses: [
      "Local runtime is unavailable",
      "Whisper CLI or server process crashed",
      "The request reached the route but the backend failed processing"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/ui/voice-errors.ts",
      "src/ui/error-registry.ts"
    ],
    checks: [
      "Inspect the route response status and body",
      "Verify whether the backend model is installed and active",
      "Check if the browser path is accidentally still reaching local transcription"
    ],
    retryable: true,
    nextStep: "Confirm the backend is healthy and ensure browser mode does not still upload the WAV to /api/transcribe unless intentionally falling back."
  },
  LOCAL_TRANSCRIBE_TIMEOUT: {
    code: "LOCAL_TRANSCRIBE_TIMEOUT",
    phase: "transcription",
    component: "Local transcription latency",
    summary: "The transcription process exceeded the allowed processing window.",
    likelyRootCauses: [
      "Model warmup took too long",
      "The captured file was too large or too noisy",
      "The backend stalled on a long-running request"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/speech/warmup-policy.ts",
      "src/ui/error-registry.ts"
    ],
    checks: [
      "Measure request durations and compare them to the warmup budget",
      "Inspect whether a busy local process is still active",
      "Check whether the local route is parallelizing work incorrectly"
    ],
    retryable: true,
    nextStep: "Baseline timeout behavior and confirm the audio size, model readiness, and fallback logic under realistic recordings."
  },
  LOCAL_WHISPER_CLI_MISSING: {
    code: "LOCAL_WHISPER_CLI_MISSING",
    phase: "transcription",
    component: "Local runtime installation",
    summary: "The local Whisper CLI dependency is missing or not installed in this runtime.",
    likelyRootCauses: [
      "Runtime package was not installed",
      "Speech model files are absent",
      "This machine is running a browser-only build without the local binary"
    ],
    filesToInspect: [
      "src/ui/voice-errors.ts",
      "src/ui/error-registry.ts",
      "desktop-runtime/**",
      "offline-speech/**",
      "app/components/voice-order-console.tsx"
    ],
    checks: [
      "Verify the CLI is actually present on disk",
      "Confirm the install output and runtime preparation steps",
      "Confirm the app knows whether it is in browser or desktop mode"
    ],
    retryable: false,
    nextStep: "Repair the installation path or force browser-first mode for machines that cannot run the local runtime."
  },
  LOCAL_WHISPER_MODEL_MISSING: {
    code: "LOCAL_WHISPER_MODEL_MISSING",
    phase: "transcription",
    component: "Model assets",
    summary: "The runtime exists, but the model file required for transcription is absent.",
    likelyRootCauses: [
      "Model files were never downloaded or packaged",
      "The wrong folder is being used at runtime",
      "Packaging excluded required offline-speech assets"
    ],
    filesToInspect: [
      "offline-speech/**",
      "desktop-runtime/**",
      "desktop/prepare-runtime.mjs",
      "src/ui/voice-errors.ts"
    ],
    checks: [
      "Check the offline-speech model directory",
      "Verify packaging outputs include the required model files",
      "Compare runtime path assumptions with actual file locations"
    ],
    retryable: false,
    nextStep: "Repair the packaging or installation state so the local model can be discovered at runtime."
  },
  LOCAL_WHISPER_RUNTIME_UNAVAILABLE: {
    code: "LOCAL_WHISPER_RUNTIME_UNAVAILABLE",
    phase: "transcription",
    component: "Runtime lifecycle",
    summary: "The local speech model process is present but not ready to accept audio tasks.",
    likelyRootCauses: [
      "The server is booting or rewarming",
      "The process crashed and never reopened",
      "A resource lock caused the runtime to stall"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/speech/warmup-policy.ts",
      "src/ui/error-registry.ts"
    ],
    checks: [
      "Check warmup readiness and keepalive logic",
      "Inspect runtime health and process-level status",
      "Look for stalled or missing background servers"
    ],
    retryable: true,
    nextStep: "Rebuild runtime readiness and confirm the warmup sequence is not silently failing before transcription begins."
  },
  TRANSCRIPTION_BUDGET_EXCEEDED: {
    code: "TRANSCRIPTION_BUDGET_EXCEEDED",
    phase: "transcription",
    component: "Speech processing budget",
    summary: "The system spent too long processing the recording and did not get a safe final transcript.",
    likelyRootCauses: [
      "Long audio exceeded the acceptable model budget",
      "Warmup or queueing delay was too high",
      "Background work piled up behind a stuck request"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/ui/error-registry.ts",
      "src/audio/endpointing.ts"
    ],
    checks: [
      "Compare elapsed transcript time against model budget",
      "Measure queue buildup and contention",
      "Check whether a longer or noisier recording is hitting the guardrails"
    ],
    retryable: true,
    nextStep: "Make the budget explicit and capture the actual time before deciding whether a request should be retried or abandoned."
  },
  INTERPRETATION_FAILED: {
    code: "INTERPRETATION_FAILED",
    phase: "interpretation",
    component: "Order interpretation",
    summary: "The transcript arrived but the conversion into an order or correction could not be validated safely.",
    likelyRootCauses: [
      "Intent routing produced an ambiguous result",
      "The menu context updated mid-request",
      "The transcript contradicted the product model or table state"
    ],
    filesToInspect: [
      "app/components/voice-order-console.tsx",
      "src/order-understanding/**",
      "src/semantic-menu/**",
      "src/ui/draft-actions.ts"
    ],
    checks: [
      "Inspect interpretTurns and draft revision validation",
      "Review routeIntent output and selected menu candidates",
      "Check if provisional review is being silently dropped"
    ],
    retryable: true,
    nextStep: "Trace the transcript-to-draft conversion and confirm the interpretation stage never commits an ambiguous result."
  },
  POS_UNAVAILABLE: {
    code: "POS_UNAVAILABLE",
    phase: "pos",
    component: "POS adapter",
    summary: "The validated order was prepared but could not be safely transmitted to the POS layer.",
    likelyRootCauses: [
      "The adapter is not ready",
      "POS capabilities were downgraded during runtime",
      "The response path is missing or did not confirm the order"
    ],
    filesToInspect: [
      "src/ui/draft-actions.ts",
      "src/pos/**",
      "app/components/voice-order-console.tsx"
    ],
    checks: [
      "Confirm the adapter is capable of create order or open order read",
      "Check whether the order reached the POS and was read back",
      "Inspect the final commit path and the response contract"
    ],
    retryable: false,
    nextStep: "Validate the POS adapter contract and the post-send confirmation flow."
  }
};

export const ERROR_PHASE_INDEX: Record<ErrorPhaseKey, string[]> = {
  startup: [
    "STARTUP_ERROR",
    "MENU_LOAD_FAILED",
    "LOCAL_WHISPER_RUNTIME_UNAVAILABLE"
  ],
  menu: [
    "MENU_LOAD_FAILED",
    "INVALID_REQUEST",
    "STALE_MENU"
  ],
  microphone: [
    "MICROPHONE_DENIED",
    "MICROPHONE_STREAM_FAILED",
    "NO_SPEECH_DETECTED",
    "AUDIO_ONLY_NOISE"
  ],
  "browser-speech": [
    "BROWSER_SPEECH_UNAVAILABLE",
    "BROWSER_SPEECH_FAILED",
    "BROWSER_SPEECH_NO_RESULT"
  ],
  "audio-finalization": [
    "AUDIO_CHUNKS_EMPTY",
    "AUDIO_SAMPLE_RATE_INVALID",
    "AUDIO_WAV_HEADER_INVALID",
    "WAV_CREATION_FAILED",
    "AUDIO_ONLY_NOISE"
  ],
  transcription: [
    "LOCAL_TRANSCRIBE_API_FAILED",
    "LOCAL_TRANSCRIBE_TIMEOUT",
    "LOCAL_WHISPER_CLI_MISSING",
    "LOCAL_WHISPER_MODEL_MISSING",
    "LOCAL_WHISPER_RUNTIME_UNAVAILABLE",
    "TRANSCRIPTION_BUDGET_EXCEEDED"
  ],
  interpretation: [
    "INTERPRETATION_FAILED",
    "INVALID_REQUEST",
    "POS_UNAVAILABLE"
  ],
  pos: [
    "POS_UNAVAILABLE"
  ],
  unknown: [
    "UNKNOWN"
  ]
};

export function findErrorCatalogEntry(code: string): ErrorCatalogEntry | undefined {
  return ERROR_CATALOG[code] ?? ERROR_CATALOG["UNKNOWN"];
}

export function describeErrorPath(code: string): string {
  const entry = findErrorCatalogEntry(code);
  return entry ? `${entry.phase} :: ${entry.component} :: ${entry.summary}` : "unknown :: general diagnostic layer :: no precise match was found";
}
