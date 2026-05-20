import { NextRequest, NextResponse } from "next/server";

/** POST /api/admin/auth  { password: string } → 200 | 401 */
export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string };
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "ADMIN_PASSWORD not set" }, { status: 503 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
