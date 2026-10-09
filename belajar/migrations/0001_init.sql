-- Belajar Al-Qur'an — learner progress (database `dakwah_belajar`).
-- Separate database from the main app (plan §7.4): `user_id` is the main
-- app's users.id (uuid as text) with NO foreign key across databases;
-- account deletion arrives as a signed `user-deleted` event + nightly sweep.
-- Anonymous learners never reach this database: their progress lives in
-- localStorage until they sign in, then merges here.

CREATE TABLE IF NOT EXISTS learners (
  user_id       text PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- Lesson completion (one row per learner × lesson).
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id     text NOT NULL REFERENCES learners(user_id) ON DELETE CASCADE,
  lesson_id   text NOT NULL,
  status      text NOT NULL CHECK (status IN ('started', 'completed')),
  score       real,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

-- Spaced repetition (FSRS via ts-fsrs). item_id = "<surah>:<ayah>:<word>/<skill>"
-- e.g. "1:2:1/meaning", "1:2:1/case"; `card` is the ts-fsrs Card state.
CREATE TABLE IF NOT EXISTS srs_cards (
  user_id     text NOT NULL REFERENCES learners(user_id) ON DELETE CASCADE,
  item_id     text NOT NULL,
  card        jsonb NOT NULL,
  due         timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS srs_cards_due_idx ON srs_cards (user_id, due);

CREATE TABLE IF NOT EXISTS srs_reviews (
  id           bigserial PRIMARY KEY,
  user_id      text NOT NULL REFERENCES learners(user_id) ON DELETE CASCADE,
  item_id      text NOT NULL,
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  log          jsonb
);
CREATE INDEX IF NOT EXISTS srs_reviews_user_idx ON srs_reviews (user_id, reviewed_at);

-- Checkpoints and the Ujian Al-Fatihah.
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL REFERENCES learners(user_id) ON DELETE CASCADE,
  quiz_id     text NOT NULL,
  score       real NOT NULL,
  passed      boolean NOT NULL,
  answers     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_attempts_user_idx ON quiz_attempts (user_id, quiz_id);
