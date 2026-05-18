"use client";

import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { Camera, X, Loader2, AlertCircle } from "lucide-react";
import type { CaptureTilt } from "@/lib/types";
import {
  subscribeOrientation,
  getOrientationStoreVersion,
  readOrientationAngles,
  attachGlobalOrientation,
  requestIOSOrientationAndAttach,
  orientationListenerActive,
} from "@/lib/deviceOrientationStore";

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
 * MediaStream kept for the browser tab session so reopening the camera
 * for wall 2+ typically reuses the same permission without another
 * system prompt (especially noticeable on mobile Safari).
 */
let sharedCameraStream: MediaStream | null = null;

function releaseSharedCameraStream() {
  if (sharedCameraStream) {
    sharedCameraStream.getTracks().forEach((t) => t.stop());
    sharedCameraStream = null;
  }
}

const STORAGE_CAM_GRANT = "facade-camera-granted";

function streamStillUsable(stream: MediaStream | null): boolean {
  if (!stream) return false;
  const v = stream.getVideoTracks()[0];
  return !!v && v.readyState === "live";
}

/**
 * In-app camera with a horizontal level line.
 *
 * Orientation: `deviceOrientationStore` keeps a single listener for the
 * whole SPA session so the user does not have to tap "Aktivoi vesivaaka"
 * again on every new capture.
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

  useSyncExternalStore(
    subscribeOrientation,
    getOrientationStoreVersion,
    () => 0,
  );
  const { gamma, beta } = readOrientationAngles();

  // Sivuttainen kallistus (roll / γ). Vain tämä näytetään käyttäjälle.
  const roll = gamma;
  // Pitch (β) tallennetaan silti pystyperspektiivin korjausta varten,
  // mutta sitä ei näytetä.

  const DOE =
    typeof window !== "undefined"
      ? (window.DeviceOrientationEvent as DeviceOrientationEventWithPermission | undefined)
      : undefined;
  const isIosMotionApi =
    typeof DOE?.requestPermission === "function";
  // ── Start / reuse camera ─────────────────────────────────────────────────
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

        if (streamStillUsable(sharedCameraStream)) {
          s = sharedCameraStream!;
        } else {
          releaseSharedCameraStream();
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
          sharedCameraStream = s;
          try {
            sessionStorage.setItem(STORAGE_CAM_GRANT, "1");
          } catch {
            /* private mode */
          }
        }

        if (cancelled) {
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
    void start();
    return () => {
      cancelled = true;
      /** Do not stop tracks here — keep `sharedCameraStream` alive for the
       *  next wall. Tracks are cleared in `releaseSharedCameraStream` when
       *  the user leaves the camera flow via the close button. */
      streamRef.current = null;
    };
  }, []);

  // ── Attach stream to <video> once the element mounts ───────────────────
  useEffect(() => {
    if (!starting && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        /* silent */
      });
    }
  }, [starting]);

  // ── Global orientation: Android/desktop immediately; iOS via button ───
  useEffect(() => {
    if (typeof window === "undefined" || !DOE) return;
    if (!isIosMotionApi) {
      attachGlobalOrientation();
    }
  }, [DOE, isIosMotionApi]);

  const TILT_OK = 2;
  const TILT_WARN = 5;
  const isLevel = roll !== null && Math.abs(roll) <= TILT_OK;
  const isBad = roll !== null && Math.abs(roll) > TILT_WARN;

  const handleClose = useCallback(() => {
    releaseSharedCameraStream();
    onClose();
  }, [onClose]);

  const handleActivateLevel = useCallback(() => {
    void requestIOSOrientationAndAttach();
  }, []);

  const handleCapture = useCallback(async () => {
    if (isIosMotionApi && !orientationListenerActive()) {
      await requestIOSOrientationAndAttach();
    }
    const video = videoRef.current;
    if (!video || !sharedCameraStream) return;
    const { beta: bNow, gamma: gNow } = readOrientationAngles();
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
      bNow !== null
        ? {
            beta: bNow,
            gamma: gNow ?? 0,
            cameraTiltDeg: 90 - bNow,
          }
        : null;
    onCapture(file, dataUrl, tilt);
  }, [onCapture, isIosMotionApi]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white">
        <button
          onClick={handleClose}
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
              onClick={handleClose}
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

            {/* Horizontal level line — the only visible level indicator */}
            <LevelLine roll={roll} isLevel={isLevel} isBad={isBad} />
          </>
        )}
      </div>

      {/* Bottom controls — iOS: activate level above shutter; then capture */}
      <div className="px-6 py-6 bg-black/80 flex flex-col items-center gap-3">
        {isIosMotionApi && !orientationListenerActive() && (
          <button
            type="button"
            onClick={handleActivateLevel}
            disabled={starting || !!error}
            className="w-full max-w-xs px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-lg text-center"
          >
            Aktivoi vesivaaka
          </button>
        )}
        <div className="w-20 h-20 shrink-0">
          <button
            type="button"
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
        </div>

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

interface LevelLineProps {
  roll: number | null;
  isLevel: boolean;
  isBad: boolean;
}

function LevelLine({ roll, isLevel, isBad }: LevelLineProps) {
  const angle = roll ?? 0;
  const color = isLevel
    ? "rgba(34, 197, 94, 0.95)"
    : isBad
      ? "rgba(239, 68, 68, 0.95)"
      : "rgba(255, 255, 255, 0.85)";
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
