# Privacy and GDPR posture

This is an engineering baseline, not legal advice. A real restaurant deployment needs
a documented controller/processor assessment and local counsel.

## Default retention

- Raw microphone blobs exist in browser memory and request memory only.
- The app does not write audio or full transcripts to its data model, logs, local
  storage, or repository.
- The API response explicitly reports `retained: false`.
- Browser persistence contains the current menu, table, and final POS-relevant draft.
- Correction analytics contain only a short fragment, IDs, error category, confidence,
  tenant/waiter identifiers, and timestamp.
- `DEBUG_RETAIN_CONVERSATION=false` is the default. The current code has no persistence
  implementation even when the flag is true; a future debug store must be separate,
  access-controlled, time-limited, and visibly enabled.

## GDPR actions before pilot

- Establish lawful basis, transparent staff/customer notice, and data-processing
  agreements with hosting, OpenAI, and POS providers.
- Complete a DPIA for ambient restaurant audio and especially any optional biometric
  waiter voice profile.
- Define deletion, access, incident-response, and international-transfer procedures.
- Minimize provider payloads and set appropriate regional/data-residency controls.
- Protect tenant credentials, use TLS, encrypt stored drafts, and record administrative
  mapping approvals.

No biometric voice profile or employee performance scoring is implemented.
