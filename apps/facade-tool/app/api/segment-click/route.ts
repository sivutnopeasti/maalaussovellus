import { NextRequest, NextResponse } from "next/server";
import { configureFal } from "@/lib/fal";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const falAny = (() => { const { fal } = require("@fal-ai/client"); return fal as any; })();

export const maxDuration = 60;

/**
 * POST /api/segment-click
 *
 * Accepts either point prompts or a bounding box:
 *
 * { imageUrl, imageWidth, imageHeight, points: [{xNorm, yNorm, label}] }
 * { imageUrl, imageWidth, imageHeight, box: {xNorm, yNorm, wNorm, hNorm} }
 *
 * Response: { maskUrl, width, height }
 */
export async function POST(req: NextRequest) {
  try {
    configureFal();

    const { imageUrl, points, box, imageWidth, imageHeight } = await req.json();

    if (!imageUrl || !imageWidth || !imageHeight) {
      return NextResponse.json(
        { error: "imageUrl, imageWidth and imageHeight are required" },
        { status: 400 },
      );
    }
    if (!points?.length && !box) {
      return NextResponse.json(
        { error: "Either points or box is required" },
        { status: 400 },
      );
    }

    // Build SAM 2 input — either point prompts or a box prompt
    const input: Record<string, unknown> = {
      image_url: imageUrl,
      apply_mask: true,
      output_format: "png",
    };

    if (points?.length) {
      input.prompts = points.map((p: { xNorm: number; yNorm: number; label: 1 | 0 }) => ({
        x: Math.round(p.xNorm * imageWidth),
        y: Math.round(p.yNorm * imageHeight),
        label: p.label,
      }));
    } else {
      // box: { xNorm, yNorm, wNorm, hNorm } — all normalized 0-1
      input.box_prompts = [{
        x_min: Math.round(box.xNorm * imageWidth),
        y_min: Math.round(box.yNorm * imageHeight),
        x_max: Math.round((box.xNorm + box.wNorm) * imageWidth),
        y_max: Math.round((box.yNorm + box.hNorm) * imageHeight),
      }];
    }

    const result = await falAny.subscribe("fal-ai/sam2/image", { input });
    const data = result.data as { image: { url: string; width?: number; height?: number } };

    return NextResponse.json({
      maskUrl: data.image.url,
      width:   data.image.width  ?? imageWidth,
      height:  data.image.height ?? imageHeight,
    });
  } catch (err) {
    console.error("[/api/segment-click]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
