"use client";

import { Loader2 } from "lucide-react";
import type { MlsdLineMapStatus } from "@/lib/useMlsdLineMap";

interface Props {
  status: MlsdLineMapStatus;
  ready: boolean;
  /** Shown when MLSD failed but the picker is still usable manually. */
  errorBanner?: string;
  children: React.ReactNode;
}

/**
 * Hides canvas content until MLSD line detection is ready. Shows a
 * loading placeholder while the hosted image / MLSD raster is fetched.
 */
export default function MlsdCanvasGate({
  status,
  ready,
  errorBanner,
  children,
}: Props) {
  const showCanvas = ready || (status === "error" && !!errorBanner);

  if (!showCanvas) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300 px-6 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-blue-400" aria-hidden />
        <p className="text-sm font-medium">
          {status === "idle"
            ? "Ladataan kuvaa…"
            : status === "loading"
              ? "Tunnistetaan reunoja…"
              : "Valmistellaan…"}
        </p>
        <p className="text-xs text-slate-400 max-w-[240px]">
          Kuva avautuu automaattisesti kun reunatunnistus on valmis.
        </p>
      </div>
    );
  }

  return (
    <>
      {status === "error" && errorBanner && (
        <div className="absolute top-2 left-2 right-2 z-20 px-3 py-2 rounded-xl bg-amber-500/95 text-amber-950 text-xs font-medium text-center shadow-lg">
          {errorBanner}
        </div>
      )}
      {children}
    </>
  );
}
