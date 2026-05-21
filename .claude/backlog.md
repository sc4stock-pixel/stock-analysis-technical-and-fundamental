# Ideas Backlog

## Pending

### #1 — Live Alert Webhooks → Telegram/WhatsApp
- **Value:** High | **Effort:** Medium (~1–2 days)
- **Added:** 2026-05-21 | **Review by:** 2026-05-27
- `AlertsPanel.tsx` already has structured `data-*` attributes on every alert node.
- Build a Next.js API route webhook dispatcher: when a BULLISH flip or reentry fires for a watchlist stock, POST to Telegram Bot API or WhatsApp Cloud API.
- Gives real-time mobile push alerts without needing the browser open.

### #2 — Portfolio P&L Tracker with Entry Tracking
- **Value:** High | **Effort:** High (~3–4 days)
- **Added:** 2026-05-21 | **Review by:** 2026-05-27
- App generates signals but doesn't track actual entries.
- Build a lightweight "portfolio" store (localStorage or small JSON on GitHub) to log actual entry price/date.
- Show live P&L vs the TA signal's recommended entry — closes the loop between analysis and execution.

---

## Completed

_(none yet)_
