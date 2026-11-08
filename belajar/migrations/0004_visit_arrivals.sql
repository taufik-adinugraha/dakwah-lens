-- Where a page view came from (operator 2026-11-08: count visits that arrive from the main site, to see
-- whether the homepage's Belajar button sends anyone). Two more counters on the same rows, both added to
-- the section's row and to the module's `semua` row, like `views`:
--   from_main: page views that were the first page of a visit and came from a page of the main site
--              (the browser's referrer is on this site, outside /belajar).
--   from_hero: of those, the ones that came through the homepage's "Belajar" button (its link carries
--              utm_source=dakwah-lens&utm_medium=hero). So from_hero <= from_main.
-- Nothing identifies a visitor: the browser reports one word ("hero", "main" or "other") and the route turns
-- it into these two numbers. Rows from before this migration hold 0 here, which means "not measured yet",
-- not "nobody came from the main site".
ALTER TABLE belajar_visit_counts
  ADD COLUMN IF NOT EXISTS from_main integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS from_hero integer NOT NULL DEFAULT 0;
