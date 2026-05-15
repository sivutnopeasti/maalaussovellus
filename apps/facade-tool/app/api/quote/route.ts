import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 30;

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
    } = body;

    if (wallAreaM2 == null || unitPrice == null) {
      return NextResponse.json(
        { error: "wallAreaM2 and unitPrice are required" },
        { status: 400 },
      );
    }

    // Use service role key if available for writes, fall back to anon key
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from("facade_quotes")
      .insert({
        project_id: projectId || null,
        image_url: imageUrl ?? null,
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

    return NextResponse.json({ quote: data });
  } catch (err) {
    console.error("[/api/quote]", err);
    return NextResponse.json(
      { error: "Quote save failed", detail: String(err) },
      { status: 500 },
    );
  }
}
