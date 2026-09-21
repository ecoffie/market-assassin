'use client';
import { useEffect, useState } from 'react';

// Module-level cache so the directory is fetched ONCE across all panels in a
// session (not per-component). Returns a Map<dodaac, officeName>.
let _cache: Map<string, string> | null = null;
let _inflight: Promise<Map<string, string>> | null = null;

async function fetchDirectory(): Promise<Map<string, string>> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = fetch('/api/app/dodaac-directory')
    .then(r => r.json())
    .then(d => {
      const m = new Map<string, string>(Object.entries(d.names || {}));
      _cache = m;
      return m;
    })
    .catch(() => new Map<string, string>());
  return _inflight;
}

/** Hook: DoDAAC code→name map for client-side office labels. Empty until loaded. */
export function useDodaacNames(): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(_cache || new Map());
  useEffect(() => {
    if (_cache) { setMap(_cache); return; }
    let live = true;
    fetchDirectory().then(m => { if (live) setMap(m); });
    return () => { live = false; };
  }, []);
  return map;
}
