# Deployment

The app is deployment-ready but no hosting account credentials are stored here. A
real smartphone microphone requires an HTTPS URL.

## Windows local model packs

Use `Service-Ears-3.2-Lokaal-Adaptief` on a roughly 16 GB development laptop. It
contains Large-v3 Turbo Q5 plus Small Q5 reserve. Use
`Service-Ears-3.2-Lokaal-Licht` on weaker or unknown hardware; it contains only Small
Q5. Both packages run the same app and accept compatible model files in
`offline-speech/models`, so rollout does not permanently depend on one large model.

The adaptive runtime checks total/free memory and processor count before loading a
model, caps transcription threads, keeps only one job active, monitors measured
latency, falls back after failures or repeated slowness, and unloads the warm model
after inactivity. Pilot each target hardware class with noisy real restaurant audio;
hardware safety and recognition quality are separate acceptance criteria.

## Fastest hosted path (Vercel)

1. Import the GitHub repository into Vercel as a Next.js project.
2. Use Node.js 22 and the default commands (`pnpm install`, `pnpm build`).
3. Start with `POS_ADAPTER=mock` and `ORDER_ENGINE_MODE=deterministic`.
4. Deploy; open the generated HTTPS URL on a phone.
5. Add it to the home screen if desired. Start shift mode, select Table 12, and test
   the built-in text demos.
6. For microphone testing, add `OPENAI_API_KEY` and keep the model defaults from
   `.env.example`. Redeploy and grant microphone permission.

Never expose `OPENAI_API_KEY` or Lightspeed tokens as `NEXT_PUBLIC_*` variables.

## Container path

```bash
docker build -t service-ears .
docker run --rm -p 3000:3000 --env-file .env service-ears
```

Place the container behind a TLS-terminating platform/load balancer. The production
image runs as a non-root user and uses Next.js standalone output.

## Local phone check

```bash
pnpm dev --hostname 0.0.0.0
```

Open `http://<computer-lan-ip>:3000` for UI testing on the same network. Most mobile
browsers will not grant microphone access on plain HTTP; use an approved HTTPS tunnel
or hosted preview for audio. Do not publish private credentials through a tunnel.

## Production checklist

- Configure encrypted environment variables and provider spending/rate limits.
- Add durable tenant-scoped storage for users, OAuth tokens, mappings, drafts, audit,
  and correction proposals.
- Add authentication, manager role UI, observability without transcripts, backup,
  deletion controls, and incident response.
- Validate the exact Lightspeed account/API variant and keep live order creation off.
- Run device, network-loss, duplicate-send, microphone-denial, and noisy-room tests.
