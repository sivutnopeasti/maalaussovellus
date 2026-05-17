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

export interface DepthMapOutput {
  image: { url: string; width?: number; height?: number };
}

/**
 * Run monocular depth estimation on a hosted image.
 *
 * Returns a greyscale raster where bright = near (the house, in our use
 * case) and dark = far (the background). The polygon-snap feature uses
 * this raster to identify which detected MLSD lines lie on the house
 * SILHOUETTE — i.e. on the boundary between bright and dark depth
 * regions — so user clicks snap onto the true facade outline rather
 * than onto any incidental line elsewhere in the photo.
 */
export async function runDepthEstimation(
  imageUrl: string,
): Promise<DepthMapOutput> {
  const result = await fal.subscribe("fal-ai/imageutils/depth", {
    input: { image_url: imageUrl },
  });
  return result.data as DepthMapOutput;
}
