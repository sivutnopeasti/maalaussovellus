"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, X, Loader2, AlertCircle } from "lucide-react";
import type { CaptureTilt } from "@/lib/types";

interface Props {
  onCapture: (file: File, dataUrl: string, tilt: CaptureTilt | null) => void;
  onClose: () => void;
  /** Otsikko ylävalikossa — esim. "Pääty (1/2)" */
  title?: string;
  /** Vihjeteksti alalaidassa */
  hint?: string;
}

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/**
 * In-app camera with a horizontal level line.
 *
 * The line is drawn across the center of the viewfinder and tilts in real
 * time with the phone's roll (γ). When the line is within ±2° of horizontal
 * it turns green — that is the sole "OK to shoot" signal shown to the user.
 *
 * The level activates automatically:
 *  - On Android / desktop, `deviceorientation` events fire without
 *    permission, so we attach the listener on mount.
 *  - On iOS 13+ the API requires a user gesture; we show a single one-tap
 *    prompt the first time the camera opens, after which orientation is
 *    available for the rest of the session.
 */
export default function CameraCapture({
  onCapture,
  onClose,
  title = "Ota kuva julkisivusta",
  hint,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  // Sivuttainen kallistus (roll / γ). Vain tämä näytetään käyttäjälle.
  const [gamma, setGamma] = useState<number | null>(null);
  // Pitch (β) tallennetaan silti pystyperspektiivin korjausta varten,
  // mutta sitä ei näytetä.
  const [beta, setBeta] = useState<number | null>(null);

  const [orientationPermission, setOrientationPermission] = useState<
    "unknown" | "granted" | "denied" | "unsupported"
  >("unknown");

  // ── Start camera ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(
            "Selaimesi ei tue kameraa. Käytä uutta selainta (Safari/Chrome).",
          );
          setStarting(false);
          return;
        }
        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          s = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStarting(false);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.name === "NotAllowedError"
              ? "Kameran käyttö estetty. Salli kameraoikeudet selaimen asetuksista."
              : err.name === "NotFoundError"
                ? "Kameraa ei löytynyt tästä laitteesta."
                : `Kameraa ei voitu avata: ${err.message}`
            : "Kameraa ei voitu avata.";
        setError(msg);
        setStarting(false);
      }
    };
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // ── Attach stream to <video> once the element mounts ─────────────────────
  useEffect(() => {
    if (!starting && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        /* silent */
      });
    }
  }, [starting]);

  // ── Orientation listener ──────────────────────────────────────────────────
  // Activates automatically on Android / desktop. On iOS we expose a button
  // (rendered below) because requestPermission needs a user gesture.
  const attachOrientation = useCallback(() => {
    const handler = (e: DeviceOrientationEvent) => {
      setGamma(e.gamma);
      setBeta(e.beta);
    };
    window.addEventListener("deviceorientation", handler);
    setOrientationPermission("granted");
    return () => window.removeEventListener("deviceorientation", handler);
  }, []);

  useEffect(() => {
    const DOE = window.DeviceOrientationEvent as
      | DeviceOrientationEventWithPermission
      | undefined;
    if (typeof DOE === "undefined") {
      setOrientationPermission("unsupported");
      return;
    }
    // Devices that do NOT require permission (Android, desktop) → attach now.
    if (typeof DOE.requestPermission !== "function") {
      return attachOrientation();
    }
    // iOS — waits for user gesture (the "Aktivoi vesivaaka" button below).
  }, [attachOrientation]);

  const requestIOSOrientation = useCallback(async () => {
    try {
      const DOE = window.DeviceOrientationEvent as DeviceOrientationEventWithPermission;
      if (typeof DOE?.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res === "granted") {
          attachOrientation();
        } else {
          setOrientationPermission("denied");
        }
      }
    } catch {
      setOrientationPermission("denied");
    }
  }, [attachOrientation]);

  // ── Level state ───────────────────────────────────────────────────────────
  const TILT_OK = 2; // ± degrees considered level
  const TILT_WARN = 5;
  const roll = gamma; // sivuttainen kallistus
  const isLevel = roll !== null && Math.abs(roll) <= TILT_OK;
  const isBad = roll !== null && Math.abs(roll) > TILT_WARN;

  // ── Capture ───────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (!blob) return;
    const file = new File([blob], `kamera-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const tilt: CaptureTilt | null =
      beta !== null
        ? {
            beta,
            gamma: gamma ?? 0,
            cameraTiltDeg: 90 - beta,
          }
        : null;
    onCapture(file, dataUrl, tilt);
  }, [beta, gamma, onCapture]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10"
          title="Sulje"
        >
          <X className="w-6 h-6" />
        </button>
        <span className="text-sm font-medium">{title}</span>
        <div className="w-10" />
      </div>

      {/* Video area */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-white gap-3">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <p className="text-sm">{error}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm"
            >
              Sulje
            </button>
          </div>
        ) : starting ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-white animate-spin" />
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* iOS-only: one-tap permission for the level */}
            {orientationPermission === "unknown" && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
                <button
                  onClick={requestIOSOrientation}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg shadow"
                >
                  Aktivoi vesivaaka
                </button>
              </div>
            )}

            {/* Horizontal level line — the only visible level indicator */}
            <LevelLine roll={roll} isLevel={isLevel} isBad={isBad} />
          </>
        )}
      </div>

      {/* Bottom controls */}
      <div className="px-6 py-6 bg-black/80 flex flex-col items-center gap-3">
        {/* Capture button */}
        <button
          onClick={handleCapture}
          disabled={starting || !!error}
          className="relative w-20 h-20 rounded-full bg-white disabled:bg-white/40 flex items-center justify-center active:scale-95 transition-transform"
          title="Ota kuva"
        >
          <div
            className={`w-16 h-16 rounded-full border-4 transition-colors ${
              isLevel
                ? "border-green-500"
                : isBad
                  ? "border-red-500"
                  : "border-slate-300"
            }`}
          />
          <Camera className="absolute w-7 h-7 text-slate-700" />
        </button>

        <p className="text-xs text-white/70 text-center max-w-xs">
          {hint ??
            (isLevel
              ? "Vesivaaka on tasossa — ota kuva nyt."
              : "Käännä puhelinta kunnes viiva on vihreä ja vaakasuora.")}
        </p>
      </div>
    </div>
  );
}

// ─── Horizontal level line ───────────────────────────────────────────────────
//
// A single line drawn across the middle of the viewfinder, rotated by the
// phone's roll. Colour: yellow while tilted, green when within ±2°, red
// when severely tilted.

interface LevelLineProps {
  roll: number | null;
  isLevel: boolean;
  isBad: boolean;
}

function LevelLine({ roll, isLevel, isBad }: LevelLineProps) {
  // While we don't have orientation data yet, fall back to a static line.
  const angle = roll ?? 0;
  const color = isLevel
    ? "rgba(34, 197, 94, 0.95)" // green
    : isBad
      ? "rgba(239, 68, 68, 0.95)" // red
      : "rgba(255, 255, 255, 0.85)"; // neutral white while user adjusts
  const shadow = isLevel
    ? "0 0 12px rgba(34, 197, 94, 0.7)"
    : isBad
      ? "0 0 12px rgba(239, 68, 68, 0.5)"
      : "0 0 6px rgba(0, 0, 0, 0.4)";

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="transition-transform duration-100"
        style={{ transform: `rotate(${angle.toFixed(2)}deg)` }}
      >
        <div
          className="h-[3px] w-[280px] rounded-full"
          style={{ backgroundColor: color, boxShadow: shadow }}
        />
        {/* Center dot */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
}
