"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Plus, Trash2, X } from "lucide-react";
import PhotoInstructions from "@/components/PhotoInstructions";

interface CapturedPhoto {
  dataUrl: string;
  file: File;
  uploading: boolean;
  storagePath: string | null;
  imageUrl: string | null;
  error: string | null;
}

type Step = "intro" | "photos" | "contact" | "submitting" | "done";

export default function AsiakasPage() {
  const [step, setStep] = useState<Step>("intro");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Capture / select photos ───────────────────────────────────────────────

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const newPhotos: CapturedPhoto[] = Array.from(files).map((file) => ({
        dataUrl: URL.createObjectURL(file),
        file,
        uploading: true,
        storagePath: null,
        imageUrl: null,
        error: null,
      }));

      setPhotos((prev) => [...prev, ...newPhotos]);

      // Upload each file immediately
      for (let i = 0; i < newPhotos.length; i++) {
        const photo = newPhotos[i];
        const globalIdx = photos.length + i;
        try {
          const fd = new FormData();
          fd.append("file", photo.file);
          const res = await fetch("/api/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { url, storageUrl, path } = (await res.json()) as {
            url: string;
            storageUrl?: string;
            path?: string;
          };
          setPhotos((prev) =>
            prev.map((p, idx) =>
              idx === globalIdx
                ? {
                    ...p,
                    uploading: false,
                    imageUrl: storageUrl ?? url,
                    storagePath: path ?? null,
                  }
                : p,
            ),
          );
        } catch (err) {
          setPhotos((prev) =>
            prev.map((p, idx) =>
              idx === globalIdx
                ? { ...p, uploading: false, error: String(err) }
                : p,
            ),
          );
        }
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
    setStep("submitting");

    const uploaded = photos.filter((p) => p.imageUrl && p.storagePath);
    if (uploaded.length === 0) {
      setSubmitError("Ei yhtään onnistuneesti ladattua kuvaa.");
      setStep("contact");
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
            storagePath: p.storagePath!,
            imageUrl: p.imageUrl!,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setStep("done");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Lähetys epäonnistui.",
      );
      setStep("contact");
    }
  }, [photos, name, phone, email]);

  const allUploaded = photos.length > 0 && photos.every((p) => !p.uploading);
  const hasError = photos.some((p) => p.error);

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <div data-scroll="true" className="absolute inset-0 bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">Kiitos!</h1>
          <p className="mt-2 text-slate-600 leading-relaxed">
            Kuvat lähetettiin onnistuneesti. Olemme sinuun yhteydessä
            tarjouksen kanssa mahdollisimman pian.
          </p>
          <button
            onClick={() => {
              setPhotos([]);
              setName("");
              setPhone("");
              setEmail("");
              setStep("intro");
            }}
            className="mt-6 px-6 py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm"
          >
            Lähetä uusi pyyntö
          </button>
        </div>
      </div>
    );
  }

  if (step === "submitting") {
    return (
      <div data-scroll="true" className="absolute inset-0 bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto" />
          <p className="text-slate-600 font-medium">Lähetetään pyyntöä…</p>
        </div>
      </div>
    );
  }

  return (
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

        {/* Step 1: Photos */}
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

          {/* Add photo button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-4 rounded-2xl border-2 border-dashed border-blue-300 text-blue-600 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-blue-50 active:scale-[0.98] transition-all"
          >
            <Plus className="w-5 h-5" />
            {photos.length === 0 ? "Ota kuva" : "Lisää kuva"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => void handleFilesSelected(e.target.files)}
          />

          {hasError && (
            <p className="text-xs text-red-600">
              Joidenkin kuvien lataaminen epäonnistui. Voit yrittää uudelleen
              poistamalla ja lisäämällä ne uudelleen.
            </p>
          )}
        </section>

        {/* Step 2: Contact info */}
        {photos.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-bold text-slate-800 text-sm uppercase tracking-wider">
              2. Yhteystiedot
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
            disabled={!allUploaded || !name.trim() || !phone.trim()}
            onClick={() => void handleSubmit()}
            className="w-full py-4 rounded-2xl bg-blue-600 disabled:bg-slate-300 text-white font-bold text-base shadow-xl shadow-blue-200 active:scale-[0.98] transition-all"
          >
            {allUploaded
              ? "Lähetä tarjouspyyntö →"
              : "Ladataan kuvia…"}
          </button>
        )}

        {submitError && (
          <p className="text-sm text-red-600 text-center">{submitError}</p>
        )}
      </div>
    </div>
  );
}
