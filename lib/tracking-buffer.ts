// Pure, dependency-free helpers for the server-sync points buffer.
//
// While a walk records, new GPS points are pushed into an in-memory buffer and
// periodically flushed to the server. These helpers model the two state
// transitions that buffer goes through so they can be unit-tested in plain Node,
// and the tracking context imports them so the tests exercise the real path.

// Take a snapshot of everything currently buffered and leave the buffer empty.
// The snapshot is what gets sent to the server.
export function drainBuffer<T>(buffer: T[]): { toSync: T[]; remaining: T[] } {
  return { toSync: [...buffer], remaining: [] };
}

// Put a failed batch back at the FRONT of whatever has accumulated since the
// drain, so points are retried in their original chronological order and nothing
// recorded during the in-flight request is lost.
export function requeueFailed<T>(failed: T[], current: T[]): T[] {
  return [...failed, ...current];
}
