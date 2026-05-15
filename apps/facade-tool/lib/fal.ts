import { fal } from "@fal-ai/client";

/** Configure fal with the server-side API key (call only in Route Handlers). */
export function configureFal() {
  fal.config({
    credentials: process.env.FAL_KEY,
  });
}

// ─── Model response types ────────────────────────────────────────────────────

export interface FalImage {
  url: string;
  content_type: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

export interface Sam2AutoSegmentOutput {
  combined_mask: FalImage;
  individual_masks: FalImage[];
}

export interface DepthAnythingOutput {
  image: FalImage;
}

export interface ControlNetSdxlOutput {
  images: FalImage[];
  prompt?: string;
  seed?: number;
  has_nsfw_concepts?: boolean[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Upload a File/Blob to fal.ai storage and return a public URL.
 * Must be called from a Route Handler (server-side, FAL_KEY available).
 */
export async function uploadToFalStorage(file: File): Promise<string> {
  const url = await fal.storage.upload(file);
  return url;
}

/** Run SAM 2 automatic segmentation on a hosted image. */
export async function runSam2AutoSegment(
  imageUrl: string,
): Promise<Sam2AutoSegmentOutput> {
  const result = await fal.subscribe("fal-ai/sam2/auto-segment", {
    input: {
      image_url: imageUrl,
      points_per_side: 32,
      pred_iou_thresh: 0.86,
      stability_score_thresh: 0.92,
      min_mask_region_area: 200,
    },
  });
  return result.data as Sam2AutoSegmentOutput;
}

// ─── SAM 2 point-prompted (click) segmentation ───────────────────────────────

export interface Sam2PointSegmentOutput {
  image: FalImage;
}

/**
 * Run SAM 2 with explicit pixel-coordinate point prompts.
 * x and y must be **pixel coordinates** in the original image space.
 * label: 1 = foreground (include), 0 = background (exclude)
 * apply_mask: false → returns binary mask (white = selected area)
 */
export async function runSam2PointSegment(
  imageUrl: string,
  points: Array<{ x: number; y: number; label: 1 | 0 }>,
): Promise<Sam2PointSegmentOutput> {
  const result = await fal.subscribe("fal-ai/sam2/image", {
    input: {
      image_url: imageUrl,
      prompts: points,
      apply_mask: false,
      output_format: "png",
    },
  });
  return result.data as unknown as Sam2PointSegmentOutput;
}

// ─── SAM 3 text-prompted segmentation ────────────────────────────────────────

export interface Sam3MaskMetadata {
  score?: number;
  /** Normalized bounding box [cx, cy, w, h] */
  box?: number[];
}

export interface Sam3Output {
  masks: FalImage[];
  metadata?: Sam3MaskMetadata[];
  boxes?: number[][];
}

/**
 * Run SAM 3 with a text prompt to locate specific objects in the image.
 * Returns up to maxMasks masks + their normalized bounding boxes.
 */
export async function runSam3Prompted(
  imageUrl: string,
  prompt: string,
  maxMasks = 6,
): Promise<Sam3Output> {
  const result = await fal.subscribe("fal-ai/sam-3/image", {
    input: {
      image_url: imageUrl,
      prompt,
      return_multiple_masks: true,
      max_masks: maxMasks,
      include_boxes: true,
      apply_mask: false,
      output_format: "png",
    },
  });
  return result.data as unknown as Sam3Output;
}

/** Run Depth Anything V2 depth estimation on a hosted image. */
export async function runDepthEstimation(
  imageUrl: string,
): Promise<DepthAnythingOutput> {
  const result = await fal.subscribe(
    "fal-ai/image-preprocessors/depth-anything/v2",
    { input: { image_url: imageUrl } },
  );
  return result.data as DepthAnythingOutput;
}

/** Run Canny edge detection — returns edge map image. */
export async function runCannyEdgeDetection(
  imageUrl: string,
): Promise<DepthAnythingOutput> {
  const result = await fal.subscribe("fal-ai/image-preprocessors/canny", {
    input: {
      image_url: imageUrl,
      low_threshold: 50,
      high_threshold: 150,
    },
  });
  return result.data as DepthAnythingOutput;
}

/** Run MLSD line-segment detection — returns image with detected lines. */
export async function runMlsdLineDetection(
  imageUrl: string,
): Promise<DepthAnythingOutput> {
  const result = await fal.subscribe("fal-ai/image-preprocessors/mlsd", {
    input: {
      image_url: imageUrl,
      score_threshold: 0.1,
      distance_threshold: 0.1,
    },
  });
  return result.data as DepthAnythingOutput;
}

/** Run SDXL + ControlNet Canny to recolor facade walls. */
export async function runVisualization(
  controlImageUrl: string,
  colorName: string,
  colorHex: string,
): Promise<ControlNetSdxlOutput> {
  const prompt = `Professional house painting, ${colorName} exterior walls color ${colorHex}, clean paint finish, architectural photography, natural daylight, photorealistic`;
  const negativePrompt =
    "cartoon, illustration, animation, blurry, low quality, deformed, ugly, unrealistic";

  const result = await fal.subscribe("fal-ai/fast-sdxl-controlnet-canny", {
    input: {
      control_image_url: controlImageUrl,
      prompt,
      negative_prompt: negativePrompt,
      num_inference_steps: 35,
      guidance_scale: 7.5,
      controlnet_conditioning_scale: 0.65,
      num_images: 1,
    },
  });
  return result.data as unknown as ControlNetSdxlOutput;
}
