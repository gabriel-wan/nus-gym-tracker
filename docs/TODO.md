# TODO

## Now
- [x] Investigate the REBOKS capacity page
- [x] Build a local scraper prototype
- [x] Scaffold the Worker project (config, src, tests)
- [x] Port the scraper to TypeScript
- [x] Decide whether to store pools as well as gyms (gyms only)
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
- [ ] How often does the upstream counter actually update?
- [ ] Do the `facility/gymnumber` JSON endpoints ever come back? (re-test occasionally)
