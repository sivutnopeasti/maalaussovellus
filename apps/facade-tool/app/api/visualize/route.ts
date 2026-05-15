import { NextRequest, NextResponse } from "next/server";
import { configureFal, runVisualization } from "@/lib/fal";

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    configureFal();

    const { imageUrl, colorName, colorHex } = await req.json();
    if (!imageUrl || !colorHex) {
      return NextResponse.json(
        { error: "imageUrl and colorHex are required" },
        { status: 400 },
      );
    }

    const result = await runVisualization(
      imageUrl,
      colorName ?? "custom color",
      colorHex,
    );

    const image = result.images[0];
    if (!image) {
      return NextResponse.json(
        { error: "No image returned from model" },
        { status: 500 },
      );
    }

    return NextResponse.json({ visualizedUrl: image.url });
  } catch (err) {
    console.error("[/api/visualize]", err);
    return NextResponse.json(
      { error: "Visualization failed", detail: String(err) },
      { status: 500 },
    );
  }
}
