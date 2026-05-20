-- Admin enhancements: customer contact info, status, photo measurement storage.

-- 1. Customer contact + status on the quote level
ALTER TABLE facade_quotes
  ADD COLUMN IF NOT EXISTS customer_name    text,
  ADD COLUMN IF NOT EXISTS customer_phone   text,
  ADD COLUMN IF NOT EXISTS customer_email   text,
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'pending';

-- 2. Allow pending quotes (no area/price calculated yet).
--    NULL passes the existing CHECK (col >= 0) constraints in PostgreSQL.
ALTER TABLE facade_quotes
  ALTER COLUMN wall_area_m2 DROP NOT NULL,
  ALTER COLUMN unit_price   DROP NOT NULL;

-- 3. Admin stores reference + polygon data per photo so results are repeatable.
ALTER TABLE facade_quote_photos
  ADD COLUMN IF NOT EXISTS reference_data jsonb,
  ADD COLUMN IF NOT EXISTS polygon_data   jsonb;

-- 4. Service role needs UPDATE on quotes + photos so admin API routes can save results.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'facade_quotes'
      AND policyname = 'Allow service role update facade_quotes'
  ) THEN
    CREATE POLICY "Allow service role update facade_quotes"
      ON facade_quotes FOR UPDATE
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'facade_quote_photos'
      AND policyname = 'Allow service role update facade_quote_photos'
  ) THEN
    CREATE POLICY "Allow service role update facade_quote_photos"
      ON facade_quote_photos FOR UPDATE
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 5. Service role INSERT on photos (for the asiakas submit route)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'facade_quote_photos'
      AND policyname = 'Allow service role insert facade_quote_photos'
  ) THEN
    CREATE POLICY "Allow service role insert facade_quote_photos"
      ON facade_quote_photos FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
