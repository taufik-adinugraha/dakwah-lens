-- How many times each test of the Kosakata learning path was tried and passed, per day (operator
-- 2026-11-03: "yes" to anonymous pass counts), so we can see where learners get stuck. `test` is a
-- batch ("1-3") or a level test ("1-tes"). There is no user, session, device or address here on
-- purpose: the module has no sign-in (plan L16), and this table cannot tell two learners apart.
CREATE TABLE IF NOT EXISTS kosakata_test_counts (
  day       date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date),
  test      text NOT NULL,
  attempts  integer NOT NULL DEFAULT 0,
  passes    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, test)
);
