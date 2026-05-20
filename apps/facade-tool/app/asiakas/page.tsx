"use client";

import { useCallback, useState } from "react";
import { Camera, CheckCircle2, Loader2, Plus, Trash2, X } from "lucide-react";
import PhotoInstructions from "@/components/PhotoInstructions";
import CameraCapture from "@/components/CameraCapture";
import type { CaptureTilt } from "@/lib/types";

interface CapturedPhoto {
  dataUrl: string;
  file: File;
  tilt: CaptureTilt | null;
  uploading: boolean;
  storagePath: string | null;
  imageUrl: string | null;
  error: string | null;
}

export default function AsiakasPage() {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // ── Camera capture ────────────────────────────────────────────────────────

  const handleCapture = useCallback(
    async (file: File, dataUrl: string, tilt: CaptureTilt | null) => {
      setShowCamera(false);
      const idx = photos.length; // capture before state update
      const newPhoto: CapturedPhoto = {
        dataUrl,
        file,
        tilt,
        uploading: true,
        storagePath: null,
        imageUrl: null,
        error: null,
      };
      setPhotos((prev) => [...prev, newPhoto]);

      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { url, storageUrl, path } = (await res.json()) as {
          url: string;
          storageUrl?: string;
          path?: string;
        };
        setPhotos((prev) =>
          prev.map((p, i) =>
            i === idx
              ? { ...p, uploading: false, imageUrl: storageUrl ?? url, storagePath: path ?? null }
              : p,
          ),
        );
      } catch (err) {
        setPhotos((prev) =>
          prev.map((p, i) =>
            i === idx ? { ...p, uploading: false, error: String(err) } : p,
          ),
        );
      }
    },
    [photos.length],
  );

  const removePhoto = useCallback((idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    setSubmitting(true);

    // Accept photos that have any URL (Fal.ai or Supabase). storagePath may
    // be null if the Supabase upload failed — use imageUrl as fallback so
    // we don't lose photos just because the optional storage layer failed.
    const uploaded = photos.filter((p) => p.imageUrl && !p.error);
    if (uploaded.length === 0) {
      setSubmitError("Ei yhtään onnistuneesti ladattua kuvaa.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/asiakas/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim() || null,
          customerPhone: phone.trim() || null,
          customerEmail: email.trim() || null,
          photos: uploaded.map((p) => ({
            storagePath: p.storagePath ?? p.imageUrl!, // Fal URL as fallback
            imageUrl: p.imageUrl!,
            tiltData: p.tilt ?? null,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Lähetys epäonnistui.");
    } finally {
      setSubmitting(false);
    }
  }, [photos, name, phone, email]);

  // ── Done screen ───────────────────────────────────────────────────────────

  if (done) {
    return (
      <div data-scroll="true" className="absolute inset-0 bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">Kiitos!</h1>
          <p className="mt-2 text-slate-600 leading-relaxed">
            Kuvat lähetettiin onnistuneesti. Olemme sinuun yhteydessä tarjouksen kanssa mahdollisimman pian.
          </p>
          <button
            onClick={() => {
              setPhotos([]);
              setName("");
              setPhone("");
              setEmail("");
              setDone(false);
            }}
            className="mt-6 px-6 py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm"
          >
            Lähetä uusi pyyntö
          </button>
        </div>
      </div>
    );
  }

  const allUploaded = photos.length > 0 && photos.every((p) => !p.uploading);
  // A photo with imageUrl is considered "ok" even if storagePath is null
  const hasError = photos.some((p) => p.error && !p.imageUrl);
  const tiltCount = photos.filter((p) => p.tilt !== null).length;

  return (
    <>
      {/* CameraCapture overlay */}
      {showCamera && (
        <CameraCapture
          title={`Seinä ${photos.length + 1}`}
          hint="Varmista että koko seinä näkyy kuvassa"
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div data-scroll="true" className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-blue-50">
        {/* Header */}
        <div className="px-5 pt-10 pb-4 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-200 mb-4">
            <Camera className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 leading-tight">
            Pyydä maalaustarjous
          </h1>
          <p className="mt-2 text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
            Ota kuva jokaisesta maalattavasta seinästä. Me hoidamme mittaukset
            — sinun ei tarvitse tehdä mitään muuta!
          </p>
        </div>

        <div className="px-5 pb-10 max-w-lg mx-auto space-y-6">
          {/* Instruction animation */}
          <PhotoInstructions />

          {/* Photos section */}
          <section className="space-y-3">
            <h2 className="font-bold text-slate-800 text-sm uppercase tracking-wider">
              Ota kuvat seinistä
            </h2>

            {/* Photo grid */}
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-square rounded-xl overflow-hidden bg-slate-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.dataUrl}
                      alt={`Seinä ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {p.uploading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                    {p.error && (
                      <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
                        <X className="w-5 h-5 text-white" />
                      </div>
                    )}
                    {!p.uploading && !p.error && (
                      <div className="absolute top-1 right-1">
                        <CheckCircle2 className="w-4 h-4 text-green-400 drop-shadow" />
                      </div>
                    )}
                    {/* Tilt indicator */}
                    {p.tilt && (
                      <div className="absolute top-1 left-1 bg-black/50 rounded px-1 py-0.5">
                        <span className="text-[9px] text-cyan-300 font-mono">
                          {p.tilt.cameraTiltDeg > 0 ? "+" : ""}
                          {p.tilt.cameraTiltDeg.toFixed(1)}°
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => removePhoto(idx)}
                      className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center"
                      aria-label="Poista kuva"
                    >
                      <Trash2 className="w-3 h-3 text-white" />
                    </button>
                    <span className="absolute bottom-1 left-1 text-[10px] text-white font-bold drop-shadow">
                      {idx + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Tilt info when photos taken */}
            {photos.length > 0 && tiltCount > 0 && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400" />
                Vesivaaka tallennettu {tiltCount}/{photos.length} kuvaan — kulmavääristymä korjataan automaattisesti
              </p>
            )}

            {/* Add photo button */}
            <button
              onClick={() => setShowCamera(true)}
              className="w-full py-4 rounded-2xl border-2 border-dashed border-blue-300 text-blue-600 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-blue-50 active:scale-[0.98] transition-all"
            >
              <Plus className="w-5 h-5" />
              {photos.length === 0 ? "Ota kuva" : "Lisää kuva"}
            </button>

            {hasError && (
              <p className="text-xs text-red-600">
                Joidenkin kuvien lataaminen epäonnistui. Poista ne ja ota uudelleen.
              </p>
            )}
          </section>

          {/* Contact info */}
          {photos.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-bold text-slate-800 text-sm uppercase tracking-wider">
                Yhteystiedot
              </h2>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Nimi *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="tel"
                  placeholder="Puhelinnumero *"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="email"
                  placeholder="Sähköposti (valinnainen)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </section>
          )}

          {/* Submit */}
          {photos.length > 0 && (
            <button
              disabled={!allUploaded || !name.trim() || !phone.trim() || submitting}
              onClick={() => void handleSubmit()}
              className="w-full py-4 rounded-2xl bg-blue-600 disabled:bg-slate-300 text-white font-bold text-base shadow-xl shadow-blue-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {submitting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Lähetetään…</>
              ) : allUploaded ? (
                "Lähetä tarjouspyyntö →"
              ) : (
                "Ladataan kuvia…"
              )}
            </button>
          )}

          {submitError && (
            <p className="text-sm text-red-600 text-center">{submitError}</p>
          )}
        </div>
      </div>
    </>
  );
}
