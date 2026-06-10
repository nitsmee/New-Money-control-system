'use client';
import { useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useOnline, flushQueue, offlineQueue } from '@/lib/offline';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/appStore';
import toast from 'react-hot-toast';

// Shows offline status + pending-sync count, and flushes queued writes when the
// connection returns (idempotent upserts, then a store refresh).
export function OfflineBanner() {
  const { online, pending } = useOnline();

  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine || offlineQueue.count() === 0) return;
      const sb = createClient();
      const { ok } = await flushQueue(sb);
      if (ok > 0) {
        toast.success(`Synced ${ok} offline change${ok > 1 ? 's' : ''}`);
        const { data: { user } } = await sb.auth.getUser();
        if (user) useAppStore.getState().loadAll(user.id);
      }
    };
    window.addEventListener('online', sync);
    sync(); // catch the case where we reconnected while the tab was closed
    return () => window.removeEventListener('online', sync);
  }, []);

  if (online && pending === 0) return null;

  return (
    <div
      className="fixed bottom-20 sm:bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full shadow-lg text-xs font-medium border"
      style={{
        background: online ? 'var(--bg-surface, #fff)' : '#fffbeb',
        borderColor: online ? 'var(--border-default, #e2e8f0)' : '#fcd34d',
        color: online ? 'var(--text-primary)' : '#92400e',
      }}
      role="status"
    >
      {online
        ? <><RefreshCw size={14} className="animate-spin text-blue-600" /> Syncing {pending} change{pending > 1 ? 's' : ''}…</>
        : <><WifiOff size={14} className="text-amber-600" /> Offline — {pending} change{pending === 1 ? '' : 's'} will sync when you reconnect</>}
    </div>
  );
}
