/**
 * Fork (see FORK.md, "Cutting without freezing the editor"). A tiny external store for the
 * "Cutting…" dialog, so module-level boolean helpers can report progress without being threaded
 * through every caller. The editor subscribes with `useSyncExternalStore`.
 */

export type BooleanProgressState = {
  label: string;
  detail: string;
  startedAt: number;
  estimatedMs: number;
  triangles: number;
  cancel: () => void;
};

let state: BooleanProgressState | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function getBooleanProgress() {
  return state;
}

export function setBooleanProgress(next: BooleanProgressState | null) {
  state = next;
  notify();
}

export function updateBooleanProgressDetail(detail: string) {
  if (!state || state.detail === detail) return;
  state = { ...state, detail };
  notify();
}

export function subscribeBooleanProgress(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type BooleanProgressReadout = { percent: number; eta: string; elapsed: string };

/** What the dialog shows for a given elapsed time against the estimate. */
export function formatBooleanProgress(elapsedMs: number, estimatedMs: number): BooleanProgressReadout {
  const elapsed = Math.max(0, elapsedMs);
  const estimate = Math.max(1, estimatedMs);
  const remainingMs = estimate - elapsed;
  const percent = Math.min(96, Math.round((elapsed / estimate) * 100));
  const eta = remainingMs > 500 ? `About ${Math.ceil(remainingMs / 1000)} s left` : "Finishing up…";
  const seconds = elapsed / 1000;
  return { percent, eta, elapsed: `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s elapsed` };
}
