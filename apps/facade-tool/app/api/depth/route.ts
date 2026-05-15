import { NextRequest, NextResponse } from "next/server";
import { configureFal, runDepthEstimation } from "@/lib/fal";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    configureFal();

    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return NextResponse.json(
        { error: "imageUrl is required" },
        { status: 400 },
      );
    }

    const result = await runDepthEstimation(imageUrl);

    return NextResponse.json({
      depthMapUrl: result.image.url,
      width: result.image.width ?? 0,
      height: result.image.height ?? 0,
    });
  } catch (err) {
    console.error("[/api/depth]", err);
    return NextResponse.json(
      { error: "Depth estimation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
