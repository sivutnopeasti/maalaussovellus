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

    // Run all four models in parallel:
    // 1. SAM 2 auto-segment  — pixel-perfect candidate masks for the whole image
    // 2. SAM 3 wall prompt   — wooden siding / painted plank surfaces
    // 3. SAM 3 opening prompt— windows and doors (masks used DIRECTLY as openings)
    // 4. SAM 3 ignore prompt — roof, sky, grass, ground, vegetation
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
          "window, door, glass opening, entrance door, window frame, window pane",
          8,
        ).catch(() => empty),
        runSam3Prompted(
          imageUrl,
          "roof, roof tiles, roof panels, sky, grass, lawn, ground, soil, vegetation, tree, bush, fence",
          10,
        ).catch(() => empty),
      ]);

    // SAM 2 masks — unclassified candidates
    const sam2Masks: MaskResult[] = sam2Result.individual_masks.map((img, idx) => ({
      index: idx,
      url: img.url,
      width: img.width ?? 0,
      height: img.height ?? 0,
      category: "ignored" as const,
    }));

    // SAM 3 opening masks — pre-classified as "opening" directly.
    // SAM 3 returns WHOLE window/door regions (not individual panes) because it
    // understands the semantic concept of "window". This solves the multi-pane
    // split problem without any manual input.
    const sam3OpeningMasks: MaskResult[] = sam3OpeningResult.masks
      .filter((img) => img.url)
      .map((img, idx) => ({
        index: 10000 + idx, // offset to avoid index collision with SAM 2 masks
        url: img.url,
        width: img.width ?? 0,
        height: img.height ?? 0,
        category: "opening" as const,
      }));

    // Combine: SAM 2 candidates + SAM 3 opening masks
    const masks: MaskResult[] = [...sam2Masks, ...sam3OpeningMasks];

    const toHints = (
      boxes?: number[][] | null,
      metadata?: { score?: number; box?: number[] }[] | null,
    ): BBoxHint[] => {
      const src =
        boxes ??
        metadata?.map((m) => m.box ?? []).filter((b) => b.length === 4) ??
        [];
      return src
        .filter((b) => Array.isArray(b) && b.length === 4)
        .map((b, i) => ({
          box: [b[0], b[1], b[2], b[3]] as [number, number, number, number],
          score: metadata?.[i]?.score,
        }));
    };

    // The best SAM 3 wall mask is used client-side for automatic corner detection.
    const wallMaskUrl = sam3WallResult.masks?.[0]?.url ?? null;

    return NextResponse.json({
      masks,
      combinedMaskUrl: sam2Result.combined_mask.url,
      wallMaskUrl,
      wallHints:    toHints(sam3WallResult.boxes,    sam3WallResult.metadata),
      openingHints: toHints(sam3OpeningResult.boxes, sam3OpeningResult.metadata),
      ignoreHints:  toHints(sam3IgnoreResult.boxes,  sam3IgnoreResult.metadata),
    });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
