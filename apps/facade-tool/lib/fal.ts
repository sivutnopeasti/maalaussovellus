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
 */
export async function runMlsdLineDetection(
  imageUrl: string,
): Promise<MlsdLineMapOutput> {
  const result = await fal.subscribe("fal-ai/image-preprocessors/mlsd", {
    input: { image_url: imageUrl },
  });
  return result.data as MlsdLineMapOutput;
}
