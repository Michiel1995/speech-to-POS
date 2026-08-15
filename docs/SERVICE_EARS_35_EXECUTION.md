# Service Ears 3.5 execution record

## Confirmed architecture

- Next.js 16 App Router, React 19 client console and typed route handlers.
- Deterministic order engine backed by a validated POS menu; no API key is required for the local build.
- Local `whisper.cpp` runtime with Silero VAD, a warmed Small Q5 first pass and an adaptive Large-v3 Turbo rescue pass.
- Compact per-table context events and per-table draft recovery in browser storage.
- POS adapter boundary with capability reporting, idempotent draft creation and order read-back.

## Root causes addressed

0. The desktop and Start-menu icons still pointed to the removed 11 August MSI installation instead of the packaged 3.5 runtime. A stale `node.exe` could remain without listening on port 3211, while the old launcher opened the browser after a fixed delay. The visible app therefore was not the build that had passed acceptance.
0.1. A normal installation path such as `Service Ears 3.5` contains spaces. PowerShell `Start-Process` joined the Node argument without quoting it, so Node tried to load a truncated path ending in `Programs\Service`. The launcher now explicitly quotes the server entry point and a regression test enforces this contract.
1. Client work was coordinated by one boolean `busy` value. A late transcription or interpretation could therefore outlive the table/draft state from which it started.
2. Review stayed visually empty until definitive local processing completed unless the optional Edge preview happened to be visible in the transcript.
3. Raw fetch/server messages were allowed to leak into the operator experience.
4. Persisted draft/context/event JSON was trusted by TypeScript casts and had no storage version.
5. POS success was inferred from the create response; it was not read back by the durable external order reference.
6. There was no field metric for stop-to-Review p50/p95 on the actual device.

## Implemented invariants

- Every text, voice, correction and send operation receives a monotonic `operationId`, `tableId` and compact base-draft revision.
- Starting a newer operation aborts the previous request. A response may mutate Review only when operation, table and base revision still match.
- Stop and completion are idempotent. An obsolete response is discarded even if its upstream process ignores cancellation.
- Interim speech matches are labelled **Voorlopig gehoord** and are never POS-sendable.
- API responses echo operation metadata; the client rejects mismatched responses.
- POS create keeps its idempotency key and is followed by `getOrder(externalOrderId)` when the adapter advertises read-back.
- Local performance samples contain only timings, operation kind and outcome—never transcript or audio—and are capped at 100 samples.
- Local draft/context/event storage accepts the validated legacy form, writes version 1 envelopes and rejects unknown/corrupt versions atomically.
- The portable launcher validates its files, owns its PID, refuses an occupied port, captures startup logs and opens Edge only after `/api/health` reports ready. The desktop and Start-menu shortcuts point directly to that launcher.

## Baseline and measured runtime

- Baseline automated suite: 12 files, 958 tests, 13.40 s Vitest duration / 14.98 s wall time.
- Standalone local runtime on the development laptop:
  - health ready: 5.22 s;
  - explicit Small Q5 warmup: 5.81 s;
  - cold reference transcription: 3.39 s;
  - warm reference transcription: 3.31 s;
  - selected model: Whisper Small Q5_1 via persistent server;
  - Large rescue: not invoked because confidence was sufficient;
  - extracted result: steak, fries, pepper sauce and two Duvel.

The app now records its own stop-to-Review p50/p95 after real operator sessions. Human speaking time is kept separate from stop-to-Review when a stop mark exists.

## Release gates

Run in order:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. `pnpm desktop:prepare`
6. `pnpm package:test-outputs`
7. standalone offline runtime test;
8. browser acceptance on the packaged app;
9. verify generated `CHECKSUMS-SHA256.txt`.

Final release result: 14 test files and 976 tests passed; TypeScript, ESLint and the production build passed; all three package checksum sets passed. Packaged-browser acceptance verified menu question → contextual choice → explicit addition → POS read-back → reload recovery. That acceptance run found and fixed one additional regression where stale Leffe context could override an explicit later Duvel mention.

## Rollback

The desktop-launcher recheck used the shortcut-started 3.5 server, not the development server. A real WAV went through local Whisper Small Q5_1 and produced `1 × Belgian beef steak` plus `2 × Duvel`. The visible Review then showed both lines, resolved the required cooking choice, created the mock POS order and retained the confirmed result after a full browser reload. The browser console remained free of errors.

The clean-install acceptance removed registered versions 0.1.0 and 0.2.3, active data from those installations, outputs 2.0 through 3.4 and four orphaned 3.4 launcher processes. The checksum-verified adaptive package was installed at `%LOCALAPPDATA%\Programs\Service Ears 3.5`. A cold shortcut start launched the Node runtime from that exact directory; the real WAV completed locally in 3.711 seconds, Review rendered both products, the mock POS confirmed the order, reload recovery passed and the browser console remained clean.

- Stop Service Ears 3.5 and start the untouched 3.4 output directory.
- Storage version 1 is isolated behind the same keys and the parser still accepts the legacy record form.
- To roll code back without touching operator data, revert the 3.5 files and leave browser storage intact. Do not delete table drafts as part of application rollback.

## Known limits

- Fully local Whisper is finalized after stop; true word-by-word local streaming would require a different streaming decoder and substantially more continuous CPU use. The optional Edge preview supplies interim text without making it authoritative.
- Speech recognition can be improved and measured but cannot be guaranteed correct for every dialect, noise condition or implied intent. Uncertain product matches remain blocking Review issues.
- The Lightspeed adapter intentionally does not create a live order because its configured public capability does not expose the required safe parked-draft semantics.
