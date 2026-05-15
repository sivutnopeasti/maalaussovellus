import { NextRequest, NextResponse } from "next/server";
import { configureFal, runSam2AutoSegment } from "@/lib/fal";
import type { MaskResult } from "@/lib/types";

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

    const result = await runSam2AutoSegment(imageUrl);

    const masks: MaskResult[] = result.individual_masks.map((img, idx) => ({
      index: idx,
      url: img.url,
      width: img.width ?? 0,
      height: img.height ?? 0,
      category: "ignored" as const,
    }));

    return NextResponse.json({
      masks,
      combinedMaskUrl: result.combined_mask.url,
    });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
