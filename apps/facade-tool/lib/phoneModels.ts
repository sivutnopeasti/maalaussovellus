/**
 * Phone model focal length database.
 *
 * f35mm = 35 mm–equivalent focal length of the main (1×) camera lens.
 * Source: manufacturer specs pages (Apple, Samsung) and GSMArena.
 *
 * Pixel focal length ratio used in keystone correction:
 *   f_ratio = f35mm / 24
 * (derivation: vertical FOV of 35mm sensor = 24 mm, so
 *   f_px = imageHeight × f35mm / 24)
 */

export interface PhoneModel {
  id: string;
  name: string;
  /** 35 mm–equivalent focal length of main camera (mm). */
  f35mm: number;
}

/** f_ratio = f35mm / 24 — use as focalRatio in calculatePolygonMeasurement */
export function focalRatioFromModel(model: PhoneModel): number {
  return model.f35mm / 24;
}

export const PHONE_MODELS: PhoneModel[] = [
  // ── Apple iPhone ──────────────────────────────────────────────────────────
  // Source: apple.com/fi/iphone-*/specs/
  { id: "iphone16pro",   name: "iPhone 16 Pro / Pro Max",   f35mm: 24 },
  { id: "iphone16",      name: "iPhone 16 / Plus",           f35mm: 26 },
  { id: "iphone15pro",   name: "iPhone 15 Pro / Pro Max",   f35mm: 24 },
  { id: "iphone15",      name: "iPhone 15 / Plus",           f35mm: 26 },
  { id: "iphone14pro",   name: "iPhone 14 Pro / Pro Max",   f35mm: 24 },
  { id: "iphone14",      name: "iPhone 14 / Plus",           f35mm: 26 },
  { id: "iphone13",      name: "iPhone 13 / mini",           f35mm: 26 },
  { id: "iphone12",      name: "iPhone 12 (kaikki)",         f35mm: 26 },
  { id: "iphonese3",     name: "iPhone SE (3. sukupolvi)",   f35mm: 28 },

  // ── Samsung Galaxy ────────────────────────────────────────────────────────
  // Source: samsung.com/fi/smartphones/ ja gsmarena.com
  { id: "s25ultra",      name: "Samsung Galaxy S25 Ultra",  f35mm: 23 },
  { id: "s25",           name: "Samsung Galaxy S25 / S25+", f35mm: 23 },
  { id: "s24ultra",      name: "Samsung Galaxy S24 Ultra",  f35mm: 24 },
  { id: "s24",           name: "Samsung Galaxy S24 / S24+", f35mm: 24 },
  { id: "a55",           name: "Samsung Galaxy A55",         f35mm: 23 },
  { id: "a35",           name: "Samsung Galaxy A35",         f35mm: 26 },

  // ── Google Pixel ──────────────────────────────────────────────────────────
  // Source: store.google.com/fi/ ja gsmarena.com
  { id: "pixel9pro",     name: "Google Pixel 9 Pro",         f35mm: 27 },
  { id: "pixel9",        name: "Google Pixel 9",             f35mm: 25 },

  // ── Generic fallback ─────────────────────────────────────────────────────
  { id: "other",         name: "Muu / En tiedä",             f35mm: 24 },
];

const LS_KEY = "facade-phone-model-id";

export function getStoredPhoneModel(): PhoneModel | null {
  try {
    const id = localStorage.getItem(LS_KEY);
    if (!id) return null;
    return PHONE_MODELS.find((m) => m.id === id) ?? null;
  } catch {
    return null;
  }
}

export function storePhoneModel(model: PhoneModel): void {
  try {
    localStorage.setItem(LS_KEY, model.id);
  } catch {
    /* private mode */
  }
}

/** Stored focalRatio, or 1.0 (≈ 24 mm equiv) as a neutral fallback. */
export function getStoredFocalRatio(): number {
  const model = getStoredPhoneModel();
  return model ? focalRatioFromModel(model) : 1.0;
}
