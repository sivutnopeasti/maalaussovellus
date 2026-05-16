import { NextRequest, NextResponse } from "next/server";
import { configureFal, runMlsdLineDetection } from "@/lib/fal";

export const maxDuration = 60;

/**
 * POST /api/lines
 *
 * Body: { imageUrl: string }
 * Returns: { url: string }  — fal.ai-hosted URL of the M-LSD line map
 *                              (white lines on a black background)
 *
 * The result page calls this in the background once the user reaches the
 * polygon-drawing step. The polygon select component then uses the line
 * map to snap user clicks onto the nearest detected structural edge for
 * pixel-accurate area outlines.
 */
export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = (await req.json()) as { imageUrl?: string };
    if (!imageUrl) {
      return NextResponse.json(
        { error: "imageUrl is required" },
        { status: 400 },
      );
    }

    configureFal();
    const out = await runMlsdLineDetection(imageUrl);
    return NextResponse.json({ url: out.image.url });
  } catch (err) {
    console.error("[/api/lines]", err);
    return NextResponse.json(
      { error: "MLSD line detection failed", detail: String(err) },
      { status: 500 },
    );
  }
}
