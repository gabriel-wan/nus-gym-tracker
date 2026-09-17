# Data source: REBOKS capacity page

Everything here was verified by direct observation on **2026-09-17**, not assumed.

## URL

```
https://reboks.nus.edu.sg/nus_public_web/public/index.php/facilities/capacity
```

Reached via the QR code on the REBOKS login page, labelled
*"Scan/Click QR to view live traffic at gym/pool"*.

**No authentication.** A plain `GET` with no cookies returns `200 OK`. This is the
single most important property of the data source — it means the scraper needs no
NUS credentials, no session handling, and no login flow.

## HTTP response

| Property | Value |
|---|---|
| Status | `200 OK` |
| Content-Type | `text/html; charset=UTF-8` |
| Size | ~16 KB |
| Response time | ~0.3 s |
| Redirects | none |
| Server | Apache 2.4.37 (RHEL) |

Response headers worth noting:

- `Cache-Control: no-store, no-cache, must-revalidate` — every request is generated
  fresh, so we never need cache-busting query parameters.
- `Set-Cookie: ci_session=...` — a CodeIgniter (PHP) session cookie. It is **set but
  not required**; requests without it succeed. We ignore it.
- `X-Frame-Options: SAMEORIGIN` — irrelevant to us, but means the page cannot be
  embedded in an iframe if a web UI is ever built.

There is no `robots.txt` on the host (it returns `404`), so no crawl directives apply.

## Is the data server-rendered? Yes

The occupancy numbers are present in the initial HTML response. No JavaScript
execution is needed, which is why a plain HTTP client is sufficient and a headless
browser is not.

## Is there a JSON API? Yes — but it does not work

This deserves detail, because the honest answer is "sort of, and you can't use it".

The page loads `assets/js/trafficUpdate.js`, which reveals an intended JSON API:

```js
setInterval(() => {
    Promise.all([
        $.get($('#baseUrl').val() + "facility/gymnumber"),
        $.get($('#baseUrl').val() + "facility/swimnumber")
    ]).then(res => { /* sets each box's text to total_attendance + "/" + capacity */ });
}, 1000 * 60);
```

From this we learn the intended response shape:

```
{ "results": [ { "venue_id": ..., "total_attendance": ..., "capacity": ... } ] }
```

**However, the endpoints are not reachable.** Both `facility/gymnumber` and
`facility/swimnumber` return `404` under every variation tried (with and without
`index.php`, with a valid `ci_session` cookie, with `X-Requested-With: XMLHttpRequest`,
with a matching `Referer`). Crucially, a deliberately nonsense control path such as
`index.php/facility/zzzznotreal` returns a **byte-identical** response — `404`,
`application/json`, body `""`. The named endpoints are therefore indistinguishable
from routes that do not exist.

The page's own auto-refresh is also broken: `$('#baseUrl')` matches nothing (there is
no element with that id anywhere in the HTML), so the script requests the malformed
relative URL `undefinedfacility/gymnumber`. The "live" page does not actually
live-update; it is only as fresh as the last full page load.

**Conclusion: parse the HTML.** If the JSON endpoints are ever restored they would be
the better source, and `venue_id` / `total_attendance` / `capacity` tell us exactly
what to expect. Worth re-testing occasionally, but do not build on them today.

## Facilities and IDs

Four facilities are published — two gyms, two pools:

| ID | Name | Kind | Capacity observed |
|---|---|---|---|
| 26 | University Town - Fitness gym | gym | 120 |
| 39 | University Sports Centre - Gym | gym | 110 |
| 25 | University Town - Recreational swimming pool | pool | 50 |
| 41 | Kent Ridge - Swimming Pool | pool | 250 |

The two gyms this project targets are **26 (UTown)** and **39 (USC)**.

### Are the IDs stable?

**Probably, but not verified over time.** The evidence for stability is that
`trafficUpdate.js` uses the same number as `venue_id` when matching API results back to
DOM elements (`$('#' + element.venue_id + " b")`). That means the `id` attribute is not
a presentation artifact — it is REBOKS's internal venue identifier, almost certainly a
database primary key.

We have only observed them on a single day, so this remains an assumption. Mitigation:
store `facility_name` alongside `facility_id` in every row, so that if an ID is ever
reassigned we can detect the mismatch rather than silently merging two facilities.

## How occupancy and capacity are represented

One machine-generated line per facility, no nesting, no line breaks inside:

```html
<div class='gymbox' id='39'><span>University Sports Centre - Gym</span><b>109/110</b></div>
```

- `class` — `gymbox` or `swimbox`, the only signal distinguishing gyms from pools.
- `id` — the facility/venue ID.
- `<span>` — display name. Note `Kent Ridge -  Swimming Pool` contains a double space,
  so names must be whitespace-normalised.
- `<b>` — `occupancy/capacity` as plain integers.

Capacity is read from the page on every observation rather than hardcoded, because it
is a property of the moment, not of the facility. (A third-party tracker reports
different denominators for the same gyms, which suggests capacities do change.)

### Extraction method

A single regular expression over the raw HTML. Regex on HTML is normally a mistake, but
it is defensible here: the markup is emitted by a PHP loop, is perfectly uniform, and
has no nested or optional structure. The parse is all-or-nothing — if zero facilities
match, the scraper raises instead of returning an empty list, because an empty list
would be indistinguishable from "every gym is empty" and would poison the history.

When this moves into the Worker, Cloudflare's built-in `HTMLRewriter` is an alternative
that needs no dependency. That decision belongs to the Worker stage, not now.

## What the number actually measures

Entry to each gym is by QR scan, and the displayed figure changes when someone scans.
So it is **not a headcount** — it is the number of people who have scanned in and not
yet scanned out.

Two sources of error, pulling opposite ways but not equally:

- People sometimes forget to scan in, which **undercounts**.
- People usually do not scan out, which **overcounts** — and this is the bigger effect.

So the reported figure probably runs **higher** than the number of people actually in
the gym, and the gap likely widens through the day.

One caveat against assuming it only ever climbs: USC was observed going 110 -> 109 ->
108 -> 107 over a few minutes on 2026-09-17, so exits do get recorded some of the time.
The bias is upward drift, not a pure ratchet.

### Two things this makes testable

**Does the count reset at closing?** It plausibly must, or it would climb indefinitely.
The sampling window runs to 23:59 and resumes at 06:00 SGT, which brackets closing time,
so a few days of data will show it directly. If it does reset, a `0` at 07:00 is a reset
artifact rather than a measurement.

**Does the count clamp at capacity?** At 20:38 on 2026-09-17, USC read exactly `110/110`.
If the counter is capped at the published capacity, then `110/110` means "110 or more"
and a full gym is indistinguishable from an overfull one. Frequent exact-capacity
readings in the history would confirm it.

### What this means for the bot

Do not present the number as fact. `109/110` is *reported* occupancy, not "there are 109
people in there". The comparison **between** the two gyms is more trustworthy than either
absolute figure, since both are counted the same way — another reason `/gym` should lead
with percentages and with which gym is quieter, rather than raw headcount.

## What happens when a facility is closed

Observed at **01:57 SGT** (all facilities shut): every facility still appears, with
occupancy `0` and its normal capacity — e.g. `0/110`. The boxes are not hidden or
removed.

**This creates a real ambiguity: `0` means "closed", "open but empty", or "counter
offline", and the page gives us no way to tell them apart.**

### A resolved case, and why the ambiguity remains

At **20:38 SGT on a Wednesday** — peak evening — the readings were:

```
Kent Ridge - Swimming Pool:            107/250
University Town - Recreational pool:     8/50
University Sports Centre - Gym:        109/110   <- effectively full
University Town - Fitness gym:           0/120   <- ?
```

USC at 99% while UTown reads exactly `0` is not plausible as real demand.

**Resolved: the UTown gym was closed**, reopening 18 September 2026. So the `0` was
correct — it meant "closed", not "broken counter".

**But note how we resolved it: someone told us.** The page itself gave no signal. There
is no `closed` flag, no `null`, no missing box — a shut gym and an empty gym are byte
identical. The specific case is settled; the general ambiguity is exactly as it was.

**Implication for the project:** do not trust `0` as a measurement. Store it verbatim,
but treat sustained zeroes as suspect. A workable rule, once there is history: if a
facility reads 0 for N consecutive samples while the other gym is active, treat it as
unavailable rather than empty. Long runs of zeroes are also how we can learn opening
hours empirically, since REBOKS does not publish them here.

**A free validation opportunity:** UTown reopens on 18 September 2026. If the collector
is running by then, its first non-zero reading is direct confirmation that the counter
works and that our reading of `0` was right. Worth deploying before that.

## Assumptions

1. The page stays publicly reachable without authentication.
2. Facility IDs are stable over time.
3. The one-line `<div class='...box' id='...'>` markup stays uniform.
4. Numbers come from QR scans at entry, so they are a proxy for occupancy rather than
   a measurement of it (see above).
5. Reported times are Singapore local time (UTC+8).

## Limitations

- **Snapshot only.** The page exposes the current number and no history at all. Any
  historical or predictive feature depends entirely on data we collect ourselves.
- **Unknown upstream refresh rate.** `trafficUpdate.js` polls every 60 s, which hints
  the underlying counter updates at least that often, but the true cadence is unknown.
  Values were observed changing within ~30 s (USC went 110 → 109 → 108), so the feed is
  genuinely live.
- **No per-zone detail** — one number for a whole gym.
- **Only four facilities.** MPSH3 gym is absent here although a third-party tracker
  lists it, so that data must come from somewhere else.

## What could break the scraper

| Failure | Detection | Severity |
|---|---|---|
| HTML structure changes | regex matches 0 facilities → raises | high, but loud |
| Facility added or removed | row count changes | low |
| Facility renamed | name changes for a known ID | low |
| Facility ID reassigned | name/ID mismatch | high, and silent |
| Page moved or auth added | non-200 status | high, loud |
| Counter offline reporting `0` | **none** — looks like real data | high, and silent |
| Capacity changed | denominator changes | low (already stored per row) |
| Rate limiting / WAF | 429 or 403 | medium |
| REBOKS downtime | timeout or 5xx | low, transient |

The silent failures are the dangerous ones. The loud ones take care of themselves.
