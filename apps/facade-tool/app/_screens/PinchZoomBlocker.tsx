"use client";

import { useEffect } from "react";

/**
 * Blocks page-level pinch-zoom on iOS Safari.
 *
 * Even with `maximum-scale=1, user-scalable=no` in the viewport meta tag,
 * Safari has historically ignored the directive in some configurations
 * (e.g. while a text field is focused or after a rotation). It instead
 * fires non-standard `gesturestart`/`gesturechange`/`gestureend` events
 * for two-finger gestures.
 *
 * Calling `preventDefault()` on those events reliably suppresses the
 * native zoom while leaving normal touch interactions (taps, single-
 * finger pans, the canvas's own pinch handler) untouched.
 */
export default function PinchZoomBlocker() {
  useEffect(() => {
    const stop = (e: Event) => {
      e.preventDefault();
    };
    // The Safari-specific gesture events. Non-standard but stable.
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("gestureend", stop);

    // Also catch the case where two fingers come down on a part of the
    // page that doesn't have its own touch handler — preventDefault on
    // the touchmove keeps the page from zooming. We only intervene for
    // multi-touch sequences so single-finger scrolling still works.
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    // Defeat double-tap-to-zoom: if two taps land < 300 ms apart,
    // swallow the second one's default action.
    let lastTouchEnd = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    };
    document.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
  return null;
}
