# TODO

## Now
- [x] Investigate the REBOKS capacity page
- [x] Build a local scraper prototype
- [x] Scaffold the Worker project (config, src, tests)
- [x] Port the scraper to TypeScript
- [x] Decide whether to store pools as well as gyms (gyms only)
- [x] Restrict the cron to gym opening hours (06:00-23:59 SGT)
- [ ] Create a Cloudflare account, then `wrangler login`
- [ ] Deploy the Worker and confirm the cron fires on Cloudflare

## Next
- [ ] D1 schema + first migration
- [ ] Write observations to D1 from `scheduled()`
- [ ] Telegram `/gym`

## Later
- [ ] Historical analysis (`/history`, `/best`)
- [ ] Prediction, measured against a day-of-week/hour average baseline
- [ ] Alerts

## Open questions
- [x] Why did UTown read `0/120` all evening on 2026-09-17? Closed; reopens 18 Sep 2026
- [ ] Are facility IDs stable over months?
- [x] How does the counter work? QR scan at entry; exits often not scanned
- [ ] Does the count reset at closing? (bracketed by the sampling window)
- [ ] Does the count clamp at capacity? (watch for repeated exact-capacity readings)
- [ ] Do the `facility/gymnumber` JSON endpoints ever come back? (re-test occasionally)
