import { NextRequest, NextResponse } from "next/server";
import { configureFal, runDepthEstimation } from "@/lib/fal";

export const maxDuration = 60;

/**
 * POST /api/depth
 *
 * Body: { imageUrl: string }
 * Returns: { url: string }  — fal.ai-hosted URL of the depth map raster
 *                              (bright pixels = near, dark = far)
 *
 * Used in tandem with /api/lines: the result page fetches both in
 * parallel, then PolygonSelect intersects the MLSD line mask with the
 * depth-gradient mask to produce a "house silhouette" mask. Clicks snap
 * onto the nearest pixel in that combined mask, ensuring the polygon
 * corners land on the true facade outline rather than any incidental
 * line in the photo.
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
    const out = await runDepthEstimation(imageUrl);
    return NextResponse.json({ url: out.image.url });
  } catch (err) {
    console.error("[/api/depth]", err);
    return NextResponse.json(
      { error: "Depth estimation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
