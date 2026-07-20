DO $$ BEGIN
  CREATE TYPE room_status AS ENUM ('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS status room_status,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

UPDATE rooms
SET
  status = COALESCE(status, 'open'::room_status),
  last_activity_at = COALESCE(last_activity_at, updated_at, created_at, now())
WHERE status IS NULL OR last_activity_at IS NULL;

ALTER TABLE rooms
  ALTER COLUMN status SET DEFAULT 'open',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN last_activity_at SET DEFAULT now(),
  ALTER COLUMN last_activity_at SET NOT NULL,
  DROP COLUMN IF EXISTS canvas_snapshot,
  DROP COLUMN IF EXISTS canvas_snapshot_at;
