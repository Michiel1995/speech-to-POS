# Roadmap

## Pilot readiness

The mock vertical slice is ready for smartphone simulation after deployment. It is not
ready to take live restaurant orders because audio accuracy, persistent authentication,
and a safe Lightspeed draft mechanism require field/vendor validation.

## Next 10

| Rank | Improvement | Impact | Effort | Technical risk |
|---:|---|---|---|---|
| 1 | Confirm a safe K-Series parked/draft workflow with Lightspeed and a pilot account | Critical | Medium | High |
| 2 | Collect and label consented noisy Belgian restaurant audio; measure strict line accuracy | Critical | High | High |
| 3 | Add tenant database, encrypted OAuth tokens, durable unsent drafts, and audit trail | Critical | High | Medium |
| 4 | Add authentication and manager mapping/proposal approval UI | High | Medium | Medium |
| 5 | Upgrade capture to Realtime WebRTC, semantic VAD, and rolling provisional state | High | High | High |
| 6 | Improve speaker-role evidence and evaluate optional consented waiter voice profiles | High | High | High |
| 7 | Add real Lightspeed menu onboarding review and location-specific overrides | High | Medium | Medium |
| 8 | Add observable latency/error/submission metrics with zero transcript logging | High | Medium | Low |
| 9 | Expand correction grammar and AI evals for per-person modifier association and references | Medium | Medium | Medium |
| 10 | Harden PWA/offline queues, conflict takeover, and multi-device synchronization | Medium | High | Medium |

After items 1–4, conduct a shadow-mode pilot where the product creates no live POS
orders. Advance to controlled draft creation only after strict accuracy, latency,
privacy, and duplicate-safety gates pass.
