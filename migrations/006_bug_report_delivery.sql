-- Durable acceptance, idempotency and delivery state in the existing PostgreSQL.
-- No FK: the pre-existing report archive is independent of account deletion.
CREATE TABLE vinyl.bug_report_deliveries (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 request_id uuid NOT NULL,
 text text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
 section text NOT NULL CHECK (section IN ('collection','wishlist')),
 page text,
 version text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sheet_state text NOT NULL DEFAULT 'pending' CHECK (sheet_state IN ('pending','writing','unknown','sent')),
 mail_state text NOT NULL CHECK (mail_state IN ('disabled','pending','sending','unknown','sent','failed')),
 mail_attempts integer NOT NULL DEFAULT 0 CHECK (mail_attempts BETWEEN 0 AND 5),
 sheet_attempts integer NOT NULL DEFAULT 0 CHECK (sheet_attempts BETWEEN 0 AND 5),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,request_id)
);
CREATE INDEX bug_report_delivery_pending ON vinyl.bug_report_deliveries(next_attempt_at)
 WHERE sheet_state IN ('pending','writing','unknown') OR mail_state IN ('pending','sending');
CREATE INDEX bug_report_delivery_rate ON vinyl.bug_report_deliveries(created_at);
