-- Additive opt-in accounting. No historical backfill, content or visitor identifiers.
CREATE TABLE vinyl.statistics_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 started_at timestamptz NOT NULL
);
CREATE TABLE vinyl.statistics_daily (
 day date PRIMARY KEY,
 registrations bigint NOT NULL DEFAULT 0 CHECK(registrations>=0),
 collection_added bigint NOT NULL DEFAULT 0 CHECK(collection_added>=0),
 wishlist_added bigint NOT NULL DEFAULT 0 CHECK(wishlist_added>=0),
 active_users bigint NOT NULL DEFAULT 0 CHECK(active_users>=0)
);
CREATE TABLE vinyl.statistics_user_days (
 user_id uuid NOT NULL REFERENCES vinyl.users(id) ON DELETE CASCADE,
 day date NOT NULL,
 PRIMARY KEY(user_id,day)
);
CREATE INDEX statistics_user_days_day ON vinyl.statistics_user_days(day);
CREATE TABLE vinyl.statistics_reports (
 day date PRIMARY KEY,
 payload jsonb NOT NULL,
 recipient text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','unknown')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_error text CHECK(last_error IN ('SMTP_REJECTED','DELIVERY_UNKNOWN','ATTEMPTS_EXHAUSTED'))
);
