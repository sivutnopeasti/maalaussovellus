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

    // Run all three in parallel for speed:
    // 1. SAM 2 auto-segment — pixel-perfect masks for every region
    // 2. SAM 3 "wall" — semantic bounding boxes for exterior wall surfaces
    // 3. SAM 3 "window door" — semantic bounding boxes for openings
    const [sam2Result, sam3WallResult, sam3OpeningResult] = await Promise.all([
      runSam2AutoSegment(imageUrl),
      runSam3Prompted(
        imageUrl,
        "exterior wall, house wall, painted wall surface, facade",
        8,
      ).catch(() => ({ masks: [], boxes: [], metadata: [] } as Sam3Output)),
      runSam3Prompted(
        imageUrl,
        "window, door, glass opening, entrance",
        8,
      ).catch(() => ({ masks: [], boxes: [], metadata: [] } as Sam3Output)),
    ]);

    const masks: MaskResult[] = sam2Result.individual_masks.map((img, idx) => ({
      index: idx,
      url: img.url,
      width: img.width ?? 0,
      height: img.height ?? 0,
      category: "ignored" as const,
    }));

    // Convert SAM 3 box arrays to BBoxHint objects
    const toHints = (
      boxes?: number[][] | null,
      metadata?: { score?: number; box?: number[] }[] | null,
    ): BBoxHint[] => {
      const src = boxes ?? metadata?.map((m) => m.box ?? []).filter((b) => b.length === 4) ?? [];
      return src
        .filter((b) => Array.isArray(b) && b.length === 4)
        .map((b, i) => ({
          box: [b[0], b[1], b[2], b[3]] as [number, number, number, number],
          score: metadata?.[i]?.score,
        }));
    };

    const wallHints = toHints(sam3WallResult.boxes, sam3WallResult.metadata);
    const openingHints = toHints(
      sam3OpeningResult.boxes,
      sam3OpeningResult.metadata,
    );

    return NextResponse.json({
      masks,
      combinedMaskUrl: sam2Result.combined_mask.url,
      wallHints,
      openingHints,
    });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
