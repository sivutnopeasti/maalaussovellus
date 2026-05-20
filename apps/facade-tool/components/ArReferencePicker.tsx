"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Smartphone,
  Target,
} from "lucide-react";

// ── Minimal inline WebXR types (avoids @types/webxr dependency) ──────────────

interface _XRRigidTransform {
  readonly position: DOMPointReadOnly;
}
interface _XRPose {
  readonly transform: _XRRigidTransform;
}
interface _XRSpace extends EventTarget {}
interface _XRReferenceSpace extends _XRSpace {}
interface _XRHitTestSource {
  cancel(): void;
}
interface _XRHitTestResult {
  getPose(baseSpace: _XRSpace): _XRPose | null;
}
interface _XRFrame {
  getHitTestResults(src: _XRHitTestSource): ReadonlyArray<_XRHitTestResult>;
}
type _XRFrameCallback = (time: number, frame: _XRFrame) => void;
interface _XRSession extends EventTarget {
  requestReferenceSpace(type: string): Promise<_XRReferenceSpace>;
  requestHitTestSource(opts: { space: _XRSpace }): Promise<_XRHitTestSource>;
  requestAnimationFrame(cb: _XRFrameCallback): number;
  cancelAnimationFrame(id: number): void;
  end(): Promise<void>;
}
interface _XRSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(
    mode: string,
    opts?: Record<string, unknown>,
  ): Promise<_XRSession>;
}

// Type-safe access to navigator.xr
function getXR(): _XRSystem | undefined {
  return (navigator as unknown as { xr?: _XRSystem }).xr;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ArResult {
  meters: number;
  /** How the value was obtained. */
  method: "webxr" | "manual";
}

interface Props {
  /** Called when a measurement is confirmed. */
  onResult: (r: ArResult) => void;
  /** Called when the user wants to go back to the camera. */
  onBack: () => void;
}

// ── Platform detection ────────────────────────────────────────────────────────

type Platform = "android-webxr" | "android-fallback" | "ios" | "desktop";

async function detectPlatform(): Promise<Platform> {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !(window as any).MSStream;
  const isAndroid = /Android/.test(ua);

  if (isIOS) return "ios";
  if (!isAndroid) return "desktop";

  const xr = getXR();
  if (!xr) return "android-fallback";
  const ok = await xr.isSessionSupported("immersive-ar").catch(() => false);
  return ok ? "android-webxr" : "android-fallback";
}

// ── Component ─────────────────────────────────────────────────────────────────

type Phase =
  | "detecting"
  | "ready" // WebXR available, waiting for user to start
  | "xr-active" // session running, waiting for point 1
  | "xr-point1" // point 1 set, waiting for point 2
  | "manual" // manual input (fallback / iOS / desktop)
  | "done"; // result ready for confirmation

interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * AR-based reference measurement picker.
 *
 * On Android Chrome with WebXR support: full immersive-ar hit-test flow.
 * On iOS: instructions to use iPhone's Measure app + manual text input.
 * Desktop / fallback: quick-select buttons + manual text input.
 */
export default function ArReferencePicker({ onResult, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>("detecting");
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [xrError, setXrError] = useState<string | null>(null);
  const [capturedMeters, setCapturedMeters] = useState<number | null>(null);
  const [manualInput, setManualInput] = useState("0.9");

  // XR refs — live outside React state to avoid re-renders in the rAF loop
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<_XRSession | null>(null);
  const hitTestSourceRef = useRef<_XRHitTestSource | null>(null);
  const localSpaceRef = useRef<_XRReferenceSpace | null>(null);
  const rafIdRef = useRef<number>(0);
  const latestHitRef = useRef<Point3D | null>(null);
  const point1Ref = useRef<Point3D | null>(null);

  // Detect platform once on mount
  useEffect(() => {
    let live = true;
    detectPlatform().then((p) => {
      if (!live) return;
      setPlatform(p);
      setPhase(p === "android-webxr" ? "ready" : "manual");
    });
    return () => {
      live = false;
    };
  }, []);

  // ── WebXR helpers ───────────────────────────────────────────────────────────

  const endSession = useCallback(() => {
    if (rafIdRef.current && sessionRef.current) {
      sessionRef.current.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    hitTestSourceRef.current?.cancel();
    hitTestSourceRef.current = null;
    sessionRef.current?.end().catch(() => {
      /* ignore */
    });
    sessionRef.current = null;
    localSpaceRef.current = null;
    latestHitRef.current = null;
  }, []);

  useEffect(() => () => endSession(), [endSession]);

  const startXR = useCallback(async () => {
    const xr = getXR();
    if (!xr) return;
    setXrError(null);
    point1Ref.current = null;
    latestHitRef.current = null;

    try {
      const session = await xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        ...(overlayRef.current
          ? { domOverlay: { root: overlayRef.current } }
          : {}),
      });
      sessionRef.current = session;

      const viewerSpace = await session.requestReferenceSpace("viewer");
      const localSpace = await session.requestReferenceSpace("local");
      localSpaceRef.current = localSpace;
      hitTestSourceRef.current = await session.requestHitTestSource({
        space: viewerSpace,
      });

      setPhase("xr-active");

      // rAF loop: sample hit-test each frame so tap always gets latest result
      const loop: _XRFrameCallback = (_time, frame) => {
        rafIdRef.current = session.requestAnimationFrame(loop);
        const src = hitTestSourceRef.current;
        const ls = localSpaceRef.current;
        if (!src || !ls) return;
        const results = frame.getHitTestResults(src);
        if (results.length > 0) {
          const pose = results[0].getPose(ls);
          if (pose) {
            const p = pose.transform.position;
            latestHitRef.current = { x: p.x, y: p.y, z: p.z };
          }
        }
      };
      rafIdRef.current = session.requestAnimationFrame(loop);
    } catch (err) {
      setXrError(
        err instanceof Error ? err.message : "AR-sessio ei käynnistynyt.",
      );
      setPhase("manual");
    }
  }, []);

  // Called when user taps the "Merkitse piste" button inside the XR overlay
  const handleXrTap = useCallback(() => {
    const pos = latestHitRef.current;
    if (!pos) return; // no surface detected yet

    if (!point1Ref.current) {
      point1Ref.current = { ...pos };
      setPhase("xr-point1");
    } else {
      const p1 = point1Ref.current;
      const dx = pos.x - p1.x;
      const dy = pos.y - p1.y;
      const dz = pos.z - p1.z;
      const dist = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 100) / 100;
      endSession();
      setCapturedMeters(dist);
      setPhase("done");
    }
  }, [endSession]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleManualSubmit = useCallback(() => {
    const v = parseFloat(manualInput.replace(",", "."));
    if (Number.isFinite(v) && v >= 0.1 && v <= 20) {
      onResult({ meters: v, method: "manual" });
    }
  }, [manualInput, onResult]);

  const handleXrAccept = useCallback(() => {
    const m =
      capturedMeters ??
      parseFloat(manualInput.replace(",", "."));
    if (Number.isFinite(m) && m >= 0.1) {
      onResult({ meters: m, method: capturedMeters !== null ? "webxr" : "manual" });
    }
  }, [capturedMeters, manualInput, onResult]);

  // ── Render ───────────────────────────────────────────────────────────────────

  // Loading while detecting platform
  if (phase === "detecting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  // WebXR active — camera passthrough with DOM overlay on top
  if (phase === "xr-active" || phase === "xr-point1") {
    return (
      <div ref={overlayRef} className="absolute inset-0">
        {/* Crosshair in center — shows where the hit test points */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-20 h-20">
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/90 -translate-x-1/2" />
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/90 -translate-y-1/2" />
            <div className="absolute inset-5 rounded-full border-2 border-white/90" />
          </div>
        </div>

        {/* Point-1-confirmed badge */}
        {phase === "xr-point1" && (
          <div className="absolute top-6 left-4 right-4 bg-green-600/90 backdrop-blur-sm rounded-2xl px-4 py-3 text-white text-sm font-semibold text-center shadow-lg">
            ✓ Piste 1 merkitty — kohdista nyt toiseen pisteeseen
          </div>
        )}

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-black/60 backdrop-blur-sm space-y-3">
          <p className="text-white text-center text-sm font-medium leading-snug">
            {phase === "xr-active"
              ? "Kohdista ristikko oven tai ikkunan ensimmäiseen reunaan"
              : "Kohdista nyt toiseen reunaan (esim. oven oikea reuna)"}
          </p>
          <button
            onClick={handleXrTap}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            <Target className="w-5 h-5" />
            {phase === "xr-active" ? "Merkitse piste 1" : "Merkitse piste 2 ja laske"}
          </button>
          <button
            onClick={() => {
              endSession();
              setPhase("manual");
            }}
            className="w-full py-2 text-white/60 text-sm text-center"
          >
            Peruuta — syötä manuaalisesti
          </button>
        </div>
      </div>
    );
  }

  // AR result confirmation screen
  if (phase === "done" && capturedMeters !== null) {
    return (
      <div className="absolute inset-0 flex flex-col bg-white">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 text-sm">
            ← Takaisin
          </button>
          <h2 className="font-semibold text-sm text-slate-900">AR-mittauksen tulos</h2>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <div className="text-center">
            <p className="text-4xl font-extrabold text-slate-900">
              {capturedMeters.toFixed(2)} m
            </p>
            <p className="text-sm text-slate-500 mt-1">mitattu AR:lla</p>
          </div>
          <div className="w-full space-y-1.5">
            <p className="text-xs text-center text-slate-500">Korjaa tarvittaessa:</p>
            <input
              type="number"
              min="0.1"
              max="20"
              step="0.01"
              defaultValue={capturedMeters}
              onChange={(e) =>
                setCapturedMeters(parseFloat(e.target.value) || capturedMeters)
              }
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-center text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="px-5 pb-6 pt-3 space-y-2 border-t border-slate-100 shrink-0">
          <button
            onClick={handleXrAccept}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base shadow-xl shadow-blue-200 flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            <Check className="w-5 h-5" />
            Käytä tätä mittaa
          </button>
          <button
            onClick={() => {
              point1Ref.current = null;
              void startXR();
            }}
            className="w-full py-2.5 text-slate-500 text-sm text-center"
          >
            Mittaa uudelleen AR:lla
          </button>
        </div>
      </div>
    );
  }

  // Manual input — iOS / desktop / android-fallback / ready (WebXR option + manual)
  const parsedManual = parseFloat(manualInput.replace(",", "."));
  const canSubmit = Number.isFinite(parsedManual) && parsedManual >= 0.1;

  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <header className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 text-sm">
          ← Takaisin
        </button>
        <h2 className="font-semibold text-sm text-slate-900">Referenssimitta (AR)</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Android WebXR CTA */}
        {platform === "android-webxr" && phase === "ready" && (
          <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-blue-600 shrink-0" />
              <p className="font-semibold text-sm text-blue-900">
                AR-mittaus saatavilla
              </p>
            </div>
            <p className="text-xs text-blue-700 leading-relaxed">
              Puhelimesi tukee AR-mittausta. Kohdista kamera oveen tai ikkunaan
              ja napauta kaksi pistettä — sovellus laskee etäisyyden automaattisesti.
            </p>
            {xrError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {xrError}
              </p>
            )}
            <button
              onClick={() => void startXR()}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <Target className="w-4 h-4" />
              Aloita AR-mittaus
            </button>
          </div>
        )}

        {/* iOS instructions */}
        {platform === "ios" && (
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-1.5">
            <p className="font-semibold text-sm text-slate-900">
              iPhone: käytä Mitta-sovellusta
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Avaa iPhonen sisäinen <strong>Mitta</strong>-sovellus ja mittaa oven
              tai ikkunan leveys. Syötä tulos alla.
            </p>
          </div>
        )}

        {/* Quick-select presets */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 mb-0.5">
              {platform === "android-webxr"
                ? "Tai syötä manuaalisesti"
                : "Aukon leveys (metriä)"}
            </p>
            <p className="text-xs text-slate-500">
              Tyypilliset mitat: ovi 0,9 m · leveä ovi 1,0 m · ikkuna 1,0–1,2 m
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {["0.7", "0.9", "1.0", "1.2"].map((v) => (
              <button
                key={v}
                onClick={() => setManualInput(v)}
                className={`py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                  manualInput === v
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <input
            type="number"
            inputMode="decimal"
            min="0.1"
            max="20"
            step="0.01"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="esim. 0,9"
            className="w-full px-4 py-3 border border-slate-300 rounded-xl text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="px-5 pb-6 pt-3 border-t border-slate-100 shrink-0">
        <button
          disabled={!canSubmit}
          onClick={handleManualSubmit}
          className="w-full py-4 rounded-2xl bg-blue-600 disabled:bg-slate-300 text-white font-bold text-base shadow-xl shadow-blue-200 flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <Check className="w-5 h-5" />
          Jatka — {canSubmit ? `${parsedManual} m` : "syötä mitta"}
        </button>
      </div>
    </div>
  );
}
