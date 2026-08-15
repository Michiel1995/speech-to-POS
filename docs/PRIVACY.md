# Privacy and GDPR posture

This is an engineering baseline, not legal advice. A real restaurant deployment needs
a documented controller/processor assessment and local counsel.

## Default retention

- Raw microphone samples exist in renderer memory and a temporary request file only.
- Live Edge preview is disabled until the user enables it. When enabled, Microsoft
  processes microphone audio to return provisional transcript deltas; the UI discloses
  this next to the control. Local Whisper remains available with the option disabled.
- The app does not write audio or full transcripts to its data model, logs, local
  storage, or repository.
- The API response explicitly reports `retained: false`.
- Browser persistence contains the current menu, table, and final POS-relevant draft.
- The in-app diagnostics export uses an explicit field allowlist. It contains only
  version/runtime health, aggregate device/model capacity, viewport dimensions and
  aggregate latency/error metrics. It never includes audio, transcript text, order
  lines, table IDs, operation IDs or free-form server errors.
- Correction analytics contain only a short fragment, IDs, error category, confidence,
  tenant/waiter identifiers, and timestamp.
- The user-triggered local back-up contains the active table ID, order drafts, compact
  per-table action/context memory, and approved pronunciation mappings. It never
  contains audio, full transcripts, performance timing, local models, credentials,
  browser preview state, or a copied POS menu. The JSON file leaves the laptop only
  when the user moves it. Treat it as operational order data and store it accordingly.
- Restoring a back-up is schema- and size-validated, bounded, and atomic. The prior
  local state is kept as a one-step rollback. Restored drafts always become
  `NOT_SENT`; prior POS confirmation metadata is removed and the waiter is warned to
  recheck the current menu and availability before sending.
- `DEBUG_RETAIN_CONVERSATION=false` is the default. The current code has no persistence
  implementation even when the flag is true; a future debug store must be separate,
  access-controlled, time-limited, and visibly enabled.

## GDPR actions before pilot

- Establish lawful basis, transparent staff/customer notice, and any required
  data-processing agreements with hosting and POS providers.
- Complete a DPIA for ambient restaurant audio and especially any optional biometric
  waiter voice profile.
- Define deletion, access, incident-response, and international-transfer procedures.
- Keep microphone processing local unless a staff user explicitly enables the visible
  live-preview provider and the restaurant has documented the required notice and
  processing terms.
- Protect tenant credentials, use TLS, encrypt stored drafts, and record administrative
  mapping approvals.

No biometric voice profile or employee performance scoring is implemented.
