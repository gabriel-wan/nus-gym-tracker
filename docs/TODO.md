# TODO

## Now
- [x] Investigate the REBOKS capacity page
- [x] Build a local scraper prototype
- [ ] Decide whether to store pools as well as gyms

## Next
- [ ] Port the scraper to a Cloudflare Worker
- [ ] D1 schema + migration
- [ ] Cron Trigger every 15 minutes
- [ ] Telegram `/gym`

## Later
- [ ] Historical analysis (`/history`, `/best`)
- [ ] Prediction, measured against a day-of-week/hour average baseline
- [ ] Alerts

## Open questions
- [ ] Why did UTown read `0/120` at 20:38 on a Wednesday? Closed, or broken counter?
- [ ] Are facility IDs stable over months?
- [ ] How often does the upstream counter actually update?
- [ ] Do the `facility/gymnumber` JSON endpoints ever come back? (re-test occasionally)
