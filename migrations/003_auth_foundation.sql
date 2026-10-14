CREATE TABLE vinyl.user_auth (
  user_id uuid PRIMARY KEY REFERENCES vinyl.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active','disabled')),
  password_hash text NOT NULL,
  email_verified_at timestamptz NOT NULL,
  auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  password_changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE vinyl.auth_sessions (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES vinyl.user_auth(user_id) ON DELETE CASCADE,
  auth_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user ON vinyl.auth_sessions(user_id,created_at);
CREATE INDEX auth_sessions_expiry ON vinyl.auth_sessions(expires_at);
CREATE TABLE vinyl.auth_flows (
  id uuid PRIMARY KEY,
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('registration','reset','owner')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','verified','completed','cancelled')),
  user_id uuid REFERENCES vinyl.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_normalized text NOT NULL,
  login text,
  full_name text,
  subject_key text NOT NULL,
  eligible boolean NOT NULL,
  auth_version bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  grant_expires_at timestamptz,
  completed_at timestamptz,
  CHECK (kind <> 'registration' OR user_id IS NULL),
  CHECK (state NOT IN ('verified','completed') OR (verified_at IS NOT NULL AND grant_expires_at IS NOT NULL)),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX auth_flows_expiry ON vinyl.auth_flows(expires_at);
CREATE TABLE vinyl.auth_challenges (
  id uuid PRIMARY KEY,
  flow_id uuid NOT NULL REFERENCES vinyl.auth_flows(id) ON DELETE CASCADE,
  subject_key text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('EMAIL_VERIFICATION','PASSWORD_RESET')),
  code_hmac text NOT NULL CHECK (code_hmac ~ '^[a-f0-9]{64}$'),
  key_version integer NOT NULL CHECK (key_version = 1),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz,
  send_state text NOT NULL DEFAULT 'pending' CHECK (send_state IN ('pending','accepted','failed','unknown'))
);
CREATE UNIQUE INDEX auth_challenges_current ON vinyl.auth_challenges(subject_key,purpose) WHERE consumed_at IS NULL AND superseded_at IS NULL;
CREATE INDEX auth_challenges_flow ON vinyl.auth_challenges(flow_id,created_at);
CREATE TABLE vinyl.auth_rate_limits (
  scope text NOT NULL,
  subject_key text NOT NULL CHECK (subject_key ~ '^[a-f0-9]{64}$'),
  window_start bigint NOT NULL,
  counter integer NOT NULL CHECK (counter > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope,subject_key,window_start)
);
CREATE INDEX auth_rate_limits_expiry ON vinyl.auth_rate_limits(expires_at);
