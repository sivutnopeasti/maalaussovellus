"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  ImageIcon,
  Loader2,
  Lock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuotePhoto {
  id: string;
  image_url: string;
  wall_label: string;
  wall_area_m2: number | null;
  sort_order: number;
}

interface Quote {
  id: string;
  created_at: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  wall_area_m2: number | null;
  total_price: number | null;
  notes: string | null;
  facade_quote_photos: QuotePhoto[];
}

// ── Admin auth hook ───────────────────────────────────────────────────────────

function useAdminKey() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    setKey(sessionStorage.getItem("adminKey"));
  }, []);
  return {
    key,
    save: (k: string) => {
      sessionStorage.setItem("adminKey", k);
      setKey(k);
    },
    clear: () => {
      sessionStorage.removeItem("adminKey");
      setKey(null);
    },
  };
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
        <CheckCircle2 className="w-3 h-3" /> Valmis
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
      <Clock className="w-3 h-3" /> Odottaa
    </span>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: (key: string) => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setLoading(false);
    if (res.ok) {
      onLogin(pw);
    } else {
      setError("Väärä salasana.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 space-y-5"
      >
        <div className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center mb-4">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Hallintapaneeli</h1>
          <p className="text-sm text-slate-500 mt-1">Maalausliike — sisäinen käyttö</p>
        </div>
        <input
          type="password"
          placeholder="Salasana"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
          autoFocus
        />
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading || !pw}
          className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Kirjaudu
        </button>
      </form>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ adminKey }: { adminKey: string }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/quotes", {
      headers: { "x-admin-key": adminKey },
    });
    if (res.ok) {
      const data = (await res.json()) as { quotes: Quote[] };
      setQuotes(data.quotes);
    }
    setLoading(false);
  }, [adminKey]);

  useEffect(() => {
    void fetchQuotes();
  }, [fetchQuotes]);

  const filtered =
    filter === "all"
      ? quotes
      : quotes.filter((q) => q.status === filter);

  const pendingCount = quotes.filter((q) => q.status === "pending").length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="font-extrabold text-slate-900 text-lg">Hallintapaneeli</h1>
          <p className="text-xs text-slate-500">
            {pendingCount > 0
              ? `${pendingCount} pyyntöä odottaa käsittelyä`
              : "Kaikki käsitelty"}
          </p>
        </div>
        <button
          onClick={() => void fetchQuotes()}
          className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200"
        >
          Päivitä
        </button>
      </header>

      {/* Filter tabs */}
      <div className="px-6 pt-4 pb-2 flex gap-2">
        {(["all", "pending", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filter === f
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f === "all" ? "Kaikki" : f === "pending" ? "Odottaa" : "Valmiit"}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="px-4 py-4 max-w-4xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Ei pyyntöjä</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((q) => {
              const photoCount = q.facade_quote_photos?.length ?? 0;
              const processedCount =
                q.facade_quote_photos?.filter((p) => p.wall_area_m2 != null)
                  .length ?? 0;
              const date = new Date(q.created_at).toLocaleDateString("fi-FI", {
                day: "numeric",
                month: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <Link
                  key={q.id}
                  href={`/admin/quote/${q.id}?key=${adminKey}`}
                  className="block bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={q.status} />
                        <span className="text-xs text-slate-400">{date}</span>
                      </div>
                      <p className="font-semibold text-slate-900 truncate">
                        {q.customer_name ?? "Nimettömätön asiakas"}
                      </p>
                      {q.customer_phone && (
                        <p className="text-xs text-slate-500">
                          {q.customer_phone}
                        </p>
                      )}
                      {q.notes && (
                        <p className="text-xs text-slate-400 mt-1 truncate">
                          {q.notes}
                        </p>
                      )}
                    </div>

                    {/* Photo thumbnails */}
                    <div className="flex -space-x-2 shrink-0">
                      {q.facade_quote_photos?.slice(0, 3).map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={p.id}
                          src={p.image_url}
                          alt=""
                          className="w-10 h-10 rounded-lg object-cover border-2 border-white"
                        />
                      ))}
                      {photoCount > 3 && (
                        <div className="w-10 h-10 rounded-lg bg-slate-200 border-2 border-white flex items-center justify-center text-xs font-bold text-slate-500">
                          +{photoCount - 3}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex-1 bg-slate-100 rounded-full h-1.5 mr-3">
                      <div
                        className="h-1.5 rounded-full bg-blue-500 transition-all"
                        style={{
                          width:
                            photoCount > 0
                              ? `${(processedCount / photoCount) * 100}%`
                              : "0%",
                        }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {processedCount}/{photoCount} kuvaa käsitelty
                    </span>
                    {q.wall_area_m2 != null && (
                      <span className="ml-3 text-xs font-bold text-blue-700 whitespace-nowrap">
                        {q.wall_area_m2.toFixed(1)} m²
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { key, save } = useAdminKey();

  if (!key) {
    return <LoginForm onLogin={save} />;
  }
  return <Dashboard adminKey={key} />;
}
