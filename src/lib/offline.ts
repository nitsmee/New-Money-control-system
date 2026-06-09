'use client';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// OFFLINE-FIRST WRITE QUEUE
// Lets you log spend with no signal while traveling. When offline, a write is
// queued in localStorage with a client-generated id and optimistically added to
// the store; on reconnect the queue is flushed via UPSERT (idempotent — the
// same id means no duplicate even if a realtime/reload also picks it up).
// ============================================================

const KEY = 'mcs_offline_queue';
const EVT = 'mcs-offline-changed';

export interface QueueItem {
  id: string;                          // the row's primary key (client uuid)
  table: string;                       // e.g. 'transactions'
  payload: Record<string, unknown>;    // full row to upsert
  createdAt: number;
}

function read(): QueueItem[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(items: QueueItem[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(EVT));
}

export const offlineQueue = {
  enqueue(item: QueueItem) { const all = read(); all.push(item); write(all); },
  all(): QueueItem[] { return read(); },
  count(): number { return read().length; },
  remove(id: string) { write(read().filter(i => i.id !== id)); },
  clear() { write([]); },
};

// Flush every queued write. Uses upsert so re-flushing is safe (idempotent).
export async function flushQueue(sb: SupabaseClient): Promise<{ ok: number; failed: number }> {
  let ok = 0, failed = 0;
  for (const item of offlineQueue.all()) {
    try {
      const { error } = await sb.from(item.table).upsert(item.payload);
      if (error) { failed++; continue; }
      offlineQueue.remove(item.id);
      ok++;
    } catch { failed++; }
  }
  return { ok, failed };
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

// Reactive online status + pending-queue count.
export function useOnline(): { online: boolean; pending: number } {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    setOnline(isOnline());
    setPending(offlineQueue.count());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const changed = () => setPending(offlineQueue.count());
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener(EVT, changed);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener(EVT, changed);
    };
  }, []);
  return { online, pending };
}
