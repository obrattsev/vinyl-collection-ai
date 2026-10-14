ALTER TABLE vinyl.users ADD COLUMN show_sale_price boolean NOT NULL DEFAULT false;
ALTER TABLE vinyl.collection_records ADD COLUMN sale_price numeric CHECK (sale_price >= 0 AND sale_price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
ALTER TABLE vinyl.wishlist_records ADD COLUMN sale_price numeric CHECK (sale_price >= 0 AND sale_price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
-- File cleanup survives deletion of the account and a process crash. No user FK.
CREATE TABLE vinyl.cover_cleanup (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE CHECK (storage_key = id::text),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Import/upload cannot reclaim an ID whose filesystem cleanup is pending.
CREATE FUNCTION vinyl.prevent_pending_cover_reuse() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM vinyl.cover_cleanup WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'Cover cleanup pending' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pending_cover_reuse BEFORE INSERT ON vinyl.covers FOR EACH ROW EXECUTE FUNCTION vinyl.prevent_pending_cover_reuse();
