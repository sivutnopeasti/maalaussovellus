/**
 * Single global DeviceOrientation listener for the SPA session.
 *
 * CameraCapture unmounts after each shot; without this, the orientation
 * listener would be removed and iOS would require the user to tap
 * "Aktivoi vesivaaka" again on every new wall. Once permission is
 * granted and the listener is attached, it stays until the tab closes.
 */
const STORAGE_GRANT = "facade-device-orientation-granted";

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

let gamma: number | null = null;
let beta: number | null = null;
let listenerAttached = false;
/** Bumped on every deviceorientation event — stable snapshot for useSyncExternalStore. */
let storeVersion = 0;

function handler(e: DeviceOrientationEvent) {
  gamma = e.gamma;
  beta = e.beta;
  storeVersion += 1;
  subscribers.forEach((cb) => cb());
}

export function subscribeOrientation(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => subscribers.delete(onChange);
}

export function getOrientationStoreVersion(): number {
  return storeVersion;
}

export function readOrientationAngles(): {
  gamma: number | null;
  beta: number | null;
} {
  return { gamma, beta };
}

export function attachGlobalOrientation(): void {
  if (listenerAttached || typeof window === "undefined") return;
  window.addEventListener("deviceorientation", handler);
  listenerAttached = true;
}

/** iOS 13+: must be called from a user gesture the first time. */
export async function requestIOSOrientationAndAttach(): Promise<boolean> {
  const DOE = window.DeviceOrientationEvent as
    | (typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      })
    | undefined;

  if (typeof DOE?.requestPermission === "function") {
    try {
      const res = await DOE.requestPermission();
      if (res !== "granted") return false;
    } catch {
      return false;
    }
  }

  if (!listenerAttached) {
    window.addEventListener("deviceorientation", handler);
    listenerAttached = true;
  }
  try {
    sessionStorage.setItem(STORAGE_GRANT, "1");
  } catch {
    /* private mode */
  }
  storeVersion += 1;
  subscribers.forEach((cb) => cb());
  return true;
}

export function orientationListenerActive(): boolean {
  return listenerAttached;
}
