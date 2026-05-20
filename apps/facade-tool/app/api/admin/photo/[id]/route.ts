import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/adminAuth";

export const maxDuration = 30;

/**
 * PATCH /api/admin/photo/[id]
 * Body: { wall_area_m2?, reference_data?, polygon_data?, wall_label? }
 *
 * Saves the admin's measurement results for a single wall photo.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json()) as {
    wall_area_m2?: number | null;
    reference_data?: unknown;
    polygon_data?: unknown;
    wall_label?: string;
  };

  const supabase = createServiceSupabase();
  const update: Record<string, unknown> = {};
  if (body.wall_area_m2 !== undefined) update.wall_area_m2 = body.wall_area_m2;
  if (body.reference_data !== undefined) update.reference_data = body.reference_data;
  if (body.polygon_data !== undefined) update.polygon_data = body.polygon_data;
  if (body.wall_label !== undefined) update.wall_label = body.wall_label;

  const { data, error } = await supabase
    .from("facade_quote_photos")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ photo: data });
}
