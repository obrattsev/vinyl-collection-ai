-- Restore authority is created only by the isolated restore procedure.
CREATE TABLE vinyl.restore_epoch (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 restore_id uuid NOT NULL UNIQUE
);
CREATE TABLE vinyl.restore_quarantine (
 user_id uuid PRIMARY KEY REFERENCES vinyl.user_auth(user_id) ON DELETE CASCADE,
 restore_id uuid NOT NULL REFERENCES vinyl.restore_epoch(restore_id),
 auth_version bigint NOT NULL,
 email text NOT NULL,
 email_normalized text NOT NULL,
 UNIQUE(user_id,restore_id)
);
CREATE TABLE vinyl.restore_recovery_grants (
 flow_id uuid PRIMARY KEY REFERENCES vinyl.auth_flows(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 restore_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 FOREIGN KEY(user_id,restore_id) REFERENCES vinyl.restore_quarantine(user_id,restore_id) ON DELETE CASCADE
);
ALTER TABLE vinyl.auth_flows DROP CONSTRAINT auth_flows_kind_check;
ALTER TABLE vinyl.auth_flows ADD CHECK(kind IN ('registration','reset','owner','restore'));
