import { NextRequest, NextResponse } from "next/server";
import { configureFal, runSam3Prompted, type Sam3Output } from "@/lib/fal";
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

    // Run SAM 3 wall and opening prompts in parallel.
    // Wall mask → used for automatic corner detection client-side.
    // Opening masks → subtracted from polygon area.
    const empty: Sam3Output = { masks: [], boxes: [], metadata: [] };
    const [sam3WallResult, sam3OpeningResult] = await Promise.all([
      runSam3Prompted(
        imageUrl,
        "wooden wall cladding, wood siding, painted wood planks, horizontal boards, house wall surface",
        8,
      ).catch(() => empty),
      runSam3Prompted(
        imageUrl,
        "window, door, glass opening, entrance door, window frame, window pane",
        8,
      ).catch(() => empty),
    ]);

    // SAM 3 opening masks — pre-classified as "opening"
    const masks: MaskResult[] = sam3OpeningResult.masks
      .filter((img) => img.url)
      .map((img, idx) => ({
        index: idx,
        url: img.url,
        width: img.width ?? 0,
        height: img.height ?? 0,
        category: "opening" as const,
      }));

    // Best SAM 3 wall mask used client-side for automatic corner detection.
    const wallMaskUrl = sam3WallResult.masks?.[0]?.url ?? null;

    return NextResponse.json({ masks, wallMaskUrl });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
