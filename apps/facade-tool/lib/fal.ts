import { fal } from "@fal-ai/client";

/** Configure fal with the server-side API key (call only in Route Handlers). */
export function configureFal() {
  fal.config({
    credentials: process.env.FAL_KEY,
  });
}
