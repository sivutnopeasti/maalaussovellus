-- Store the phone tilt captured by CameraCapture at the moment of photo-taking.
-- Used by the admin panel for accurate vertical keystone correction.
ALTER TABLE facade_quote_photos
  ADD COLUMN IF NOT EXISTS tilt_data jsonb;
