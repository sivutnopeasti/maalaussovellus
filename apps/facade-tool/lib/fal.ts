import { fal } from "@fal-ai/client";

/** Configure fal with the server-side API key (call only in Route Handlers). */
export function configureFal() {
  fal.config({
    credentials: process.env.FAL_KEY,
  });
}

export interface MlsdLineMapOutput {
  image: { url: string; width?: number; height?: number };
}

/**
 * Run M-LSD line segment detection on a hosted image.
 *
 * Returns a raster of the detected structural lines — white pixels on a
 * black background. The polygon-snap feature consumes this raster: each
 * click is moved to the nearest white pixel within a tolerance radius, so
 * the user's corner picks align exactly with house edges instead of being
 * slightly off due to imprecise clicking.
 *
 * Tuning:
 *  - `score_threshold` lowered from the default 0.1 to 0.05. The MLSD
 *    detector emits a per-segment confidence score; raising it produces
 *    a cleaner but more fragmented raster (only the very strongest
 *    edges survive), while lowering it captures weaker segments too,
 *    which helps connect dashed-looking line breaks in eaves, sokkeli
 *    edges and verticals on photos taken from oblique angles.
 *  - `distance_threshold` left at 0.1 — the MLSD detector merges
 *    co-linear segments within this distance, and 0.1 already pulls
 *    multiple short segments along a long facade edge into one line.
 */
export async function runMlsdLineDetection(
  imageUrl: string,
): Promise<MlsdLineMapOutput> {
  const result = await fal.subscribe("fal-ai/image-preprocessors/mlsd", {
    input: {
      image_url: imageUrl,
      score_threshold: 0.05,
      distance_threshold: 0.1,
    },
  });
  return result.data as MlsdLineMapOutput;
}
