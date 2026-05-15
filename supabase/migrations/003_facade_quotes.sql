-- Facade quotes table for the AI-powered measurement tool
-- Each row stores one quote generated from a facade photo analysis.

CREATE TABLE IF NOT EXISTS facade_quotes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Optional link to an existing project
  project_id    uuid        REFERENCES projects(id) ON DELETE SET NULL,

  -- Image URLs stored in fal.ai CDN (public) or Supabase Storage
  image_url     text,
  visualized_url text,

  -- Measurement
  wall_area_m2  numeric     NOT NULL CHECK (wall_area_m2 >= 0),

  -- Pricing
  unit_price    numeric     NOT NULL CHECK (unit_price >= 0),
  fixed_costs   numeric     NOT NULL DEFAULT 0 CHECK (fixed_costs >= 0),
  total_price   numeric     GENERATED ALWAYS AS (wall_area_m2 * unit_price + fixed_costs) STORED,

  -- Free-form notes
  notes         text
);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION update_facade_quotes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER facade_quotes_updated_at
  BEFORE UPDATE ON facade_quotes
  FOR EACH ROW EXECUTE FUNCTION update_facade_quotes_updated_at();

-- RLS: allow all authenticated users to read/insert for now.
-- Tighten with proper policies once auth is wired up.
ALTER TABLE facade_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read"
  ON facade_quotes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated insert"
  ON facade_quotes FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Allow service role full access (used by /api/quote route handler)
CREATE POLICY "Allow service role full access"
  ON facade_quotes
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
