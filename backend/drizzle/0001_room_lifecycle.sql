DO $$ BEGIN
  CREATE TYPE room_status AS ENUM ('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS status room_status NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

UPDATE rooms
SET last_activity_at = COALESCE(updated_at, created_at, now())
WHERE last_activity_at IS NULL;

ALTER TABLE rooms
  DROP COLUMN IF EXISTS canvas_snapshot,
  DROP COLUMN IF EXISTS canvas_snapshot_at;
