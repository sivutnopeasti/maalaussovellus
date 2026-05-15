import { NextRequest, NextResponse } from "next/server";
import { configureFal, runSam2PointSegment } from "@/lib/fal";

export const maxDuration = 60;

/**
 * POST /api/segment-click
 *
 * Body: {
 *   imageUrl: string       — fal.ai hosted image URL
 *   points: Array<{
 *     xNorm: number        — normalized x (0–1) relative to image width
 *     yNorm: number        — normalized y (0–1) relative to image height
 *     label: 1 | 0        — 1 = include, 0 = exclude
 *   }>
 *   imageWidth: number     — original image pixel width
 *   imageHeight: number    — original image pixel height
 * }
 *
 * Response: { maskUrl: string, width: number, height: number }
 */
export async function POST(req: NextRequest) {
  try {
    configureFal();

    const { imageUrl, points, imageWidth, imageHeight } = await req.json();

    if (!imageUrl || !points?.length || !imageWidth || !imageHeight) {
      return NextResponse.json(
        { error: "imageUrl, points, imageWidth and imageHeight are required" },
        { status: 400 },
      );
    }

    // Convert normalised coordinates → pixel coordinates
    const pixelPoints = points.map(
      (p: { xNorm: number; yNorm: number; label: 1 | 0 }) => ({
        x: Math.round(p.xNorm * imageWidth),
        y: Math.round(p.yNorm * imageHeight),
        label: p.label,
      }),
    );

    const result = await runSam2PointSegment(imageUrl, pixelPoints);

    return NextResponse.json({
      maskUrl: result.image.url,
      width: result.image.width ?? imageWidth,
      height: result.image.height ?? imageHeight,
    });
  } catch (err) {
    console.error("[/api/segment-click]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
