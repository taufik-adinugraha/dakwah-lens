-- Runs on the first `docker compose up` (only when the postgres volume is
-- fresh). Creates the two databases the dev + prod environments share on
-- the single VM. The default DB from POSTGRES_DB (`dakwah_lens`) is still
-- created automatically and stays unused on the VM but matches the local
-- dev convention so `docker compose up` keeps working locally too.

CREATE DATABASE dakwah_lens_dev;
CREATE DATABASE dakwah_lens_prod;
