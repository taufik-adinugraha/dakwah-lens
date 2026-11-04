-- How many browsers came to each section of Belajar, per day (operator 2026-11-04: "can we track how
-- many visitors use this belajar feature?", then "yes" to anonymous counts). `section` is a section
-- (src/components/visits/visit-count.ts) or `semua`, the module as a whole: one browser can visit several
-- sections in a day, so the sections do not add up to it. `visitors`: browsers on their first view of it
-- that day. `new_visitors`: browsers on their first view of it ever. `views`: pages opened.
-- The browser itself remembers what it was counted for. There is no user, session, device or address here
-- on purpose, as in kosakata_test_counts: this table cannot tell two visitors apart.
CREATE TABLE IF NOT EXISTS belajar_visit_counts (
  day           date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date),
  section       text NOT NULL,
  visitors      integer NOT NULL DEFAULT 0,
  new_visitors  integer NOT NULL DEFAULT 0,
  views         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, section)
);
