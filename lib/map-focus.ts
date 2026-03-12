type FocusZone = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type Listener = (zone: FocusZone) => void;

let pending: FocusZone | null = null;
const listeners = new Set<Listener>();

export function setMapFocusZone(zone: FocusZone) {
  pending = zone;
  listeners.forEach((fn) => fn(zone));
}

export function consumeMapFocusZone(): FocusZone | null {
  const z = pending;
  pending = null;
  return z;
}

export function subscribeMapFocus(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
