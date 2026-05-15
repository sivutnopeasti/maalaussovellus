import { NextRequest, NextResponse } from "next/server";
import { configureFal, runDepthEstimation, runMlsdLineDetection } from "@/lib/fal";

export const maxDuration = 120;

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

    const [depthResult, mlsdResult] = await Promise.all([
      runDepthEstimation(imageUrl),
      runMlsdLineDetection(imageUrl).catch(() => null),
    ]);

    return NextResponse.json({
      depthMapUrl: depthResult.image.url,
      mlsdMapUrl: mlsdResult?.image.url ?? null,
    });
  } catch (err) {
    console.error("[/api/depth]", err);
    return NextResponse.json(
      { error: "Analysis failed", detail: String(err) },
      { status: 500 },
    );
  }
}
