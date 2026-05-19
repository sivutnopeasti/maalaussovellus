"use client";

import { Loader2 } from "lucide-react";

interface Props {
  /** What's currently happening — shown under the spinner. */
  message?: string;
}

/**
 * Plain full-screen loading state shown while the photo is uploaded and
 * (when applicable) the auto-reference analysis runs.
 */
export default function AnalysingScreen({
  message = "Käsitellään kuvaa...",
}: Props) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white px-8 gap-5">
      <div className="relative w-24 h-24">
        <div className="absolute inset-0 rounded-full bg-blue-500/30 blur-2xl animate-pulse" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-14 h-14 text-blue-300 animate-spin" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="text-lg font-semibold">{message}</p>
        <p className="text-sm text-blue-200/80">
          Lasketaan pinta-alaa ja tarkistetaan mittakaava. Älä sulje ikkunaa.
        </p>
      </div>
    </div>
  );
}
