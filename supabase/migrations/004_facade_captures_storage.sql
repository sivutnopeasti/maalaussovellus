-- Facade capture photos — Supabase Storage bucket + per-wall quote photos.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'facade-captures',
  'facade-captures',
  true,
  15728640,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read (bucket is public; explicit policy for storage.objects).
CREATE POLICY "Public read facade captures"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'facade-captures');

-- One row per wall photo linked to a quote request.
CREATE TABLE IF NOT EXISTS facade_quote_photos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      uuid        NOT NULL REFERENCES facade_quotes(id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  image_url     text        NOT NULL,
  wall_label    text        NOT NULL DEFAULT '',
  wall_area_m2  numeric     CHECK (wall_area_m2 IS NULL OR wall_area_m2 >= 0),
  sort_order    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facade_quote_photos_quote
  ON facade_quote_photos(quote_id);

ALTER TABLE facade_quote_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read facade quote photos"
  ON facade_quote_photos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow service role facade quote photos"
  ON facade_quote_photos
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE facade_quote_photos IS
  'Customer facade photos stored in facade-captures bucket, one row per measured wall.';
