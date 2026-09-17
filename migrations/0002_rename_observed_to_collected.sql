-- REBOKS exposes no observation timestamp. Its "Last Updated at" text is the
-- page render time: it tracks the request clock second for second, so it says
-- nothing about when the counter itself last changed.
--
-- We therefore only ever know when *we* collected a reading. Naming the column
-- observed_at implied a precision we do not have.
ALTER TABLE occupancy RENAME COLUMN observed_at TO collected_at;
