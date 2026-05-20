import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabaseServer";

export const maxDuration = 30;

interface QuotePhotoInput {
  storagePath: string;
  imageUrl: string;
  wallLabel?: string;
  wallAreaM2?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      imageUrl,
      visualizedUrl,
      wallAreaM2,
      unitPrice,
      fixedCosts,
      notes,
      photos,
    } = body as {
      projectId?: string | null;
      imageUrl?: string | null;
      visualizedUrl?: string | null;
      wallAreaM2?: number;
      unitPrice?: number;
      fixedCosts?: number;
      notes?: string | null;
      photos?: QuotePhotoInput[];
    };

    if (wallAreaM2 == null || unitPrice == null) {
      return NextResponse.json(
        { error: "wallAreaM2 and unitPrice are required" },
        { status: 400 },
      );
    }

    const supabase = createServiceSupabase();
    const photoList = Array.isArray(photos) ? photos : [];
    const primaryImageUrl =
      photoList[0]?.imageUrl ?? imageUrl ?? null;

    const { data, error } = await supabase
      .from("facade_quotes")
      .insert({
        project_id: projectId || null,
        image_url: primaryImageUrl,
        visualized_url: visualizedUrl ?? null,
        wall_area_m2: wallAreaM2,
        unit_price: unitPrice,
        fixed_costs: fixedCosts ?? 0,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("[/api/quote] Supabase error:", error);
      return NextResponse.json(
        { error: "Database insert failed", detail: error.message },
        { status: 500 },
      );
    }

    if (photoList.length > 0) {
      const { error: photosError } = await supabase
        .from("facade_quote_photos")
        .insert(
          photoList.map((p, i) => ({
            quote_id: data.id,
            storage_path: p.storagePath,
            image_url: p.imageUrl,
            wall_label: p.wallLabel ?? `Seinä ${i + 1}`,
            wall_area_m2: p.wallAreaM2 ?? null,
            sort_order: i,
          })),
        );

      if (photosError) {
        console.error("[/api/quote] facade_quote_photos error:", photosError);
        return NextResponse.json(
          {
            error: "Quote saved but photos failed",
            detail: photosError.message,
            quote: data,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ quote: data });
  } catch (err) {
    console.error("[/api/quote]", err);
    return NextResponse.json(
      { error: "Quote save failed", detail: String(err) },
      { status: 500 },
    );
  }
}
