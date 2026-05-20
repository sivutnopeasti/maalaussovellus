import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/adminAuth";

export const maxDuration = 30;

/** GET /api/admin/quotes — list all quote requests, newest first. */
export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("facade_quotes")
    .select(
      `id, created_at, status, customer_name, customer_phone, customer_email,
       wall_area_m2, unit_price, total_price, notes,
       facade_quote_photos(id, image_url, wall_label, wall_area_m2, sort_order)`,
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ quotes: data });
}
