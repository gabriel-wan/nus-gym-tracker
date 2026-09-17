# Database

Cloudflare D1, which is managed SQLite. One table.

## Schema

```sql
CREATE TABLE occupancy (
  id            INTEGER PRIMARY KEY,
  collected_at  TEXT    NOT NULL,
  facility_id   INTEGER NOT NULL,
  facility_name TEXT    NOT NULL,
  occupancy     INTEGER NOT NULL,
  capacity      INTEGER NOT NULL
);

CREATE INDEX idx_occupancy_facility_time
  ON occupancy (facility_id, collected_at);
```

One row per gym per scrape. Two gyms, 72 scrapes a day, so 144 rows a day and roughly
53,000 a year.

## Why each column exists

**`id`** — `INTEGER PRIMARY KEY` in SQLite is an alias for the built-in `rowid`, so this
costs nothing and gives every reading a stable handle.

**`collected_at`** — when we read the value, not when the cron was scheduled. Cloudflare
does not guarantee crons fire on time, so the schedule is not a usable clock.

It is deliberately *not* called `observed_at`. There is no observation timestamp to be
had: REBOKS renders a "Last Updated at" line, but it is the page render time and tracks
the request clock second for second, so it says nothing about when the counter last
changed. Storing it would be inventing precision. The gap between when a person scanned
in and when we noticed is real, unknown, and bounded only by our 15-minute interval.

Stored as ISO-8601 text in **UTC**, e.g. `2026-09-17T13:13:15Z`. Text rather than an
integer epoch because ISO-8601 sorts lexicographically in the same order it sorts
chronologically, so `ORDER BY collected_at` just works, and because it is readable when
you are poking at the database by hand. UTC rather than SGT because it is unambiguous;
Singapore never changes offset, but storing local time is a habit that eventually bites.

Analysis converts at query time:

```sql
-- hour of day, Singapore time
SELECT strftime('%H', datetime(collected_at, '+8 hours')) AS hour_sgt, AVG(occupancy)
FROM occupancy WHERE facility_id = 39 GROUP BY hour_sgt;
```

**`facility_id`** — REBOKS's internal id (26 UTown, 39 USC). The key that ties a gym's
readings together across months.

**`facility_name`** — deliberately denormalised. Storing the name on every row is a few
bytes and buys detection: if id 39 ever comes back under a different name, the ids have
been reassigned and the history for that id can no longer be trusted as one series. With
a separate `facilities` table we would overwrite the name and silently lose that signal.

**`occupancy`** — what REBOKS reported. Stored verbatim, including zeroes and including
readings that look wrong. Cleaning happens at read time, never on the way in; a row we
discard is gone forever, but a row we keep can always be filtered later.

Note this is not a headcount. Entry is by QR scan and people often do not scan out, so it
over-reports. See `docs/DATA-SOURCE.md`.

**`capacity`** — the denominator as reported at that moment, not a fixed property of the
gym. Capacities do change, and a historical percentage is only meaningful against the
capacity that was in force at the time.

## Why this index

```sql
CREATE INDEX idx_occupancy_facility_time ON occupancy (facility_id, collected_at);
```

Both of our query shapes are "one gym, ordered by time":

- `/gym` — the most recent row for each gym.
- Historical analysis — all rows for a gym within a date range.

A composite index on `(facility_id, collected_at)` serves both: it narrows to the gym
first, then the rows are already in time order within that group, so there is no sort.

It is worth saying that at 53,000 rows a year SQLite would scan the whole table quickly
enough that nobody would notice. The index is justified by the access pattern being
obvious and unchanging, not by the row count. If the queries were varied or unknown, the
right call would be to add no index yet and wait for a slow one.

## What is deliberately absent

- **No `facilities` table.** Two gyms. A join to look up two names would be ceremony.
- **No unique constraint on `(facility_id, collected_at)`.** It would not prevent much:
  `collected_at` is our own clock, so a re-run produces a different timestamp anyway.
  Duplicate near-identical rows are easy to spot later; a constraint that silently drops
  a legitimate reading is not.
- **No `is_closed` or `is_suspect` column.** We do not know at write time whether a `0`
  means closed, empty, or broken. Deriving that at read time, once there is history to
  compare against, keeps the stored data raw.

## Migrations

Files live in `migrations/`, numbered and applied in order. D1 tracks what it has run.

```bash
npx wrangler d1 migrations apply nus-gym-tracker --local    # local SQLite file
npx wrangler d1 migrations apply nus-gym-tracker --remote   # the real database
```

A remote migration that renames or drops a column must be paired with `npm run deploy`,
and run close together: between the two, the live Worker is talking to a schema that no
longer matches it. Adding a column is safe on its own; changing one is not.

Local development keeps its own SQLite file under `.wrangler/` and ignores
`database_id`, so the whole thing can be built and tested without a Cloudflare account.
`--remote` is what needs the real id and a login.
