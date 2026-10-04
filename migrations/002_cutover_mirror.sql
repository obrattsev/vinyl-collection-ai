CREATE TABLE vinyl.runtime_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  frozen boolean NOT NULL DEFAULT false,
  business_writes bigint NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO vinyl.runtime_control(singleton) VALUES (true);
CREATE TABLE vinyl.mirror_state (
  user_id uuid PRIMARY KEY REFERENCES vinyl.users(id) ON DELETE RESTRICT,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation >= 0),
  synced_generation bigint NOT NULL DEFAULT 0 CHECK (synced_generation >= 0 AND synced_generation <= generation),
  dirty_since timestamptz DEFAULT now(),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  verification jsonb
);
