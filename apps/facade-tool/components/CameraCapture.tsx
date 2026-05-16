"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, X, Loader2, AlertCircle } from "lucide-react";
import type { CaptureTilt } from "@/lib/types";

interface Props {
  onCapture: (file: File, dataUrl: string, tilt: CaptureTilt | null) => void;
  onClose: () => void;
}

interface DeviceOrientationEventWithPermission extends typeof DeviceOrientationEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/**
 * In-app camera with live bubble level.
 *
 * Uses `getUserMedia` for the video stream and `DeviceOrientationEvent` for
 * phone tilt. Color-codes the level indicator and tilt readout to guide the
 * customer toward holding the phone vertically (β ≈ 90°) with the horizon
 * level (γ ≈ 0°).
 *
 * On iOS 13+ DeviceOrientation requires explicit permission via a user
 * gesture — we request it the first time the customer taps "Aktivoi
 * vesivaaka".
 */
export default function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  // Phone orientation
  const [beta, setBeta] = useState<number | null>(null);  // pitch
  const [gamma, setGamma] = useState<number | null>(null); // roll
  const [orientationPermission, setOrientationPermission] =
    useState<"unknown" | "granted" | "denied" | "unsupported">("unknown");

  // Start camera on mount
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Selaimesi ei tue kameraa.");
          setStarting(false);
          return;
        }
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        setStarting(false);
      } catch (err) {
        setError(
          err instanceof Error
            ? `Kameraa ei voitu avata: ${err.message}`
            : "Kameraa ei voitu avata.",
        );
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

  // Listen for device orientation
  const startOrientation = useCallback(async () => {
    try {
      const DOE = window.DeviceOrientationEvent as DeviceOrientationEventWithPermission;
      if (typeof DOE === "undefined") {
        setOrientationPermission("unsupported");
        return;
      }
      if (typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          setOrientationPermission("denied");
          return;
        }
      }
      const handler = (e: DeviceOrientationEvent) => {
        setBeta(e.beta);
        setGamma(e.gamma);
      };
      window.addEventListener("deviceorientation", handler);
      setOrientationPermission("granted");
      return () => window.removeEventListener("deviceorientation", handler);
    } catch {
      setOrientationPermission("denied");
    }
  }, []);

  // Auto-start listening on platforms that don't need permission (most Androids)
  useEffect(() => {
    const DOE = window.DeviceOrientationEvent as DeviceOrientationEventWithPermission;
    if (typeof DOE === "undefined") {
      setOrientationPermission("unsupported");
      return;
    }
    if (typeof DOE.requestPermission !== "function") {
      const handler = (e: DeviceOrientationEvent) => {
        setBeta(e.beta);
        setGamma(e.gamma);
      };
      window.addEventListener("deviceorientation", handler);
      setOrientationPermission("granted");
      return () => window.removeEventListener("deviceorientation", handler);
    }
  }, []);

  // Compute camera tilt: phone vertical = β ≈ 90°.
  // cameraTiltDeg = 90 − β. Positive = camera tilted UP (toward sky).
  const cameraTilt = beta !== null ? 90 - beta : null;
  const roll = gamma;

  // Tolerances
  const TILT_OK = 2;     // ± degrees considered "level"
  const TILT_WARN = 5;   // larger than this = red
  const isLevel =
    cameraTilt !== null &&
    roll !== null &&
    Math.abs(cameraTilt) <= TILT_OK &&
    Math.abs(roll) <= TILT_OK;
  const isBad =
    cameraTilt !== null &&
    roll !== null &&
    (Math.abs(cameraTilt) > TILT_WARN || Math.abs(roll) > TILT_WARN);

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
      cameraTilt !== null && roll !== null
        ? {
            beta: beta ?? 0,
            gamma: gamma ?? 0,
            cameraTiltDeg: cameraTilt,
          }
        : null;
    onCapture(file, dataUrl, tilt);
  }, [beta, gamma, cameraTilt, roll, onCapture]);

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
        <span className="text-sm font-medium">Ota kuva julkisivusta</span>
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

            {/* Level overlay */}
            <LevelOverlay
              cameraTilt={cameraTilt}
              roll={roll}
              isLevel={isLevel}
              isBad={isBad}
              orientationPermission={orientationPermission}
              onRequestPermission={startOrientation}
            />

            {/* Hairline crosshair */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-px h-16 bg-white/40" />
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-px w-16 bg-white/40" />
            </div>
          </>
        )}
      </div>

      {/* Bottom controls */}
      <div className="px-6 py-6 bg-black/80 flex flex-col items-center gap-3">
        {/* Tilt summary */}
        {orientationPermission === "granted" && cameraTilt !== null && roll !== null && (
          <div
            className={`text-xs font-medium px-3 py-1 rounded-full ${
              isLevel
                ? "bg-green-500/20 text-green-200"
                : isBad
                  ? "bg-red-500/20 text-red-200"
                  : "bg-yellow-500/20 text-yellow-200"
            }`}
          >
            kallistus {cameraTilt.toFixed(0)}° · sivukallistus {roll.toFixed(0)}°
            {isLevel
              ? " — suora!"
              : isBad
                ? " — paljon vinossa"
                : " — säädä vielä"}
          </div>
        )}
        {orientationPermission === "unsupported" && (
          <div className="text-xs text-white/60">
            Tällä laitteella ei ole kallistusanturia — kuvaa silti
          </div>
        )}
        {orientationPermission === "denied" && (
          <button
            onClick={startOrientation}
            className="text-xs text-yellow-300 underline"
          >
            Aktivoi vesivaaka
          </button>
        )}

        {/* Capture button */}
        <button
          onClick={handleCapture}
          disabled={starting || !!error}
          className="relative w-20 h-20 rounded-full bg-white disabled:bg-white/40 flex items-center justify-center active:scale-95 transition-transform"
          title="Ota kuva"
        >
          <div
            className={`w-16 h-16 rounded-full border-4 ${
              isLevel
                ? "border-green-500"
                : isBad
                  ? "border-red-500"
                  : "border-slate-300"
            }`}
          />
          <Camera className="absolute w-7 h-7 text-slate-700" />
        </button>

        <p className="text-xs text-white/60 text-center max-w-xs">
          {isLevel
            ? "Pidä paikoillaan ja ota kuva — mittauksen tarkkuus on optimaalinen."
            : "Pidä puhelin suorassa (kallistus → 0°). Astu kauemmas jos koko talo ei mahdu kuvaan."}
        </p>
      </div>
    </div>
  );
}

// ─── Bubble level overlay ────────────────────────────────────────────────────

interface LevelProps {
  cameraTilt: number | null;
  roll: number | null;
  isLevel: boolean;
  isBad: boolean;
  orientationPermission: "unknown" | "granted" | "denied" | "unsupported";
  onRequestPermission: () => void;
}

function LevelOverlay({
  cameraTilt,
  roll,
  isLevel,
  isBad,
  orientationPermission,
  onRequestPermission,
}: LevelProps) {
  if (orientationPermission === "unsupported") return null;

  if (orientationPermission === "denied" || orientationPermission === "unknown") {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <button
          onClick={onRequestPermission}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg shadow"
        >
          Aktivoi vesivaaka
        </button>
      </div>
    );
  }

  if (cameraTilt === null || roll === null) return null;

  // Map tilt to bubble offset within a 100×100 circle.
  // Use ±15° as full deflection.
  const MAX_DEG = 15;
  const x = Math.max(-1, Math.min(1, roll / MAX_DEG)) * 38;
  const y = Math.max(-1, Math.min(1, cameraTilt / MAX_DEG)) * 38;

  const bubbleColor = isLevel
    ? "rgb(34, 197, 94)"        // green
    : isBad
      ? "rgb(239, 68, 68)"      // red
      : "rgb(234, 179, 8)";     // yellow

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1">
      <svg width={100} height={100} viewBox="-50 -50 100 100">
        {/* Outer ring */}
        <circle cx={0} cy={0} r={45} fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
        {/* Inner target zone */}
        <circle cx={0} cy={0} r={8} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="2,2" />
        {/* Crosshairs */}
        <line x1={-45} y1={0} x2={-12} y2={0} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
        <line x1={12} y1={0} x2={45} y2={0} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
        <line x1={0} y1={-45} x2={0} y2={-12} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
        <line x1={0} y1={12} x2={0} y2={45} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
        {/* Bubble */}
        <circle cx={x} cy={y} r={7} fill={bubbleColor} stroke="white" strokeWidth={1.5} />
      </svg>
    </div>
  );
}
