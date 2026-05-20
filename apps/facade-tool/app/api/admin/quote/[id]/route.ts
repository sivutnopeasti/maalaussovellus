import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/adminAuth";

export const maxDuration = 30;

/** GET /api/admin/quote/[id] — single quote with all photos. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("facade_quotes")
    .select(
      `*, facade_quote_photos(
        id, image_url, storage_path, wall_label, wall_area_m2,
        sort_order, reference_data, polygon_data
       )`,
    )
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  // Sort photos by sort_order
  if (data.facade_quote_photos) {
    data.facade_quote_photos.sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order,
    );
  }
  return NextResponse.json({ quote: data });
}

/** PATCH /api/admin/quote/[id] — update status and/or total area. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json()) as {
    status?: string;
    wall_area_m2?: number | null;
    unit_price?: number | null;
    notes?: string | null;
  };

  const supabase = createServiceSupabase();
  const update: Record<string, unknown> = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.wall_area_m2 !== undefined) update.wall_area_m2 = body.wall_area_m2;
  if (body.unit_price !== undefined) update.unit_price = body.unit_price;
  if (body.notes !== undefined) update.notes = body.notes;

  const { data, error } = await supabase
    .from("facade_quotes")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ quote: data });
}
