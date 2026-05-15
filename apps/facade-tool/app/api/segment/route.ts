import { NextRequest, NextResponse } from "next/server";
import {
  configureFal,
  runSam2AutoSegment,
  runSam3Prompted,
  type Sam3Output,
} from "@/lib/fal";
import type { MaskResult, BBoxHint } from "@/lib/types";

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

    // Run all four in parallel:
    // 1. SAM 2 auto-segment — pixel-perfect masks for all regions
    // 2. SAM 3 wall prompt — wooden siding / painted plank surfaces specifically
    // 3. SAM 3 opening prompt — windows and doors
    // 4. SAM 3 ignore prompt — roof, sky, grass, ground, vegetation (force-ignore)
    const empty: Sam3Output = { masks: [], boxes: [], metadata: [] };
    const [sam2Result, sam3WallResult, sam3OpeningResult, sam3IgnoreResult] =
      await Promise.all([
        runSam2AutoSegment(imageUrl),
        runSam3Prompted(
          imageUrl,
          "wooden wall cladding, wood siding, painted wood planks, horizontal boards, house wall surface",
          8,
        ).catch(() => empty),
        runSam3Prompted(
          imageUrl,
          "window, door, glass opening, entrance door",
          8,
        ).catch(() => empty),
        runSam3Prompted(
          imageUrl,
          "roof, roof tiles, roof panels, sky, grass, lawn, ground, soil, vegetation, tree, bush, fence",
          10,
        ).catch(() => empty),
      ]);

    const masks: MaskResult[] = sam2Result.individual_masks.map((img, idx) => ({
      index: idx,
      url: img.url,
      width: img.width ?? 0,
      height: img.height ?? 0,
      category: "ignored" as const,
    }));

    const toHints = (
      boxes?: number[][] | null,
      metadata?: { score?: number; box?: number[] }[] | null,
    ): BBoxHint[] => {
      const src =
        boxes ??
        metadata
          ?.map((m) => m.box ?? [])
          .filter((b) => b.length === 4) ??
        [];
      return src
        .filter((b) => Array.isArray(b) && b.length === 4)
        .map((b, i) => ({
          box: [b[0], b[1], b[2], b[3]] as [number, number, number, number],
          score: metadata?.[i]?.score,
        }));
    };

    return NextResponse.json({
      masks,
      combinedMaskUrl: sam2Result.combined_mask.url,
      wallHints: toHints(sam3WallResult.boxes, sam3WallResult.metadata),
      openingHints: toHints(sam3OpeningResult.boxes, sam3OpeningResult.metadata),
      ignoreHints: toHints(sam3IgnoreResult.boxes, sam3IgnoreResult.metadata),
    });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
