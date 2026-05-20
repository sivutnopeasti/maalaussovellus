import { NextRequest } from "next/server";

/**
 * Check admin key sent by the browser (stored in sessionStorage, forwarded
 * as the x-admin-key request header).
 */
export function requireAdmin(req: NextRequest): boolean {
  const key = req.headers.get("x-admin-key");
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && key === expected;
}
