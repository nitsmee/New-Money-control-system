'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function SessionWarning() {
  const [show, setShow] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const router = useRouter();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function checkSession() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const expiresAt = session.expires_at; // Unix timestamp in seconds
    if (!expiresAt) return;
    const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
    setShow(secondsLeft < 600);
  }

  async function handleRenew() {
    setRenewing(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        router.push('/auth/login');
      } else {
        setShow(false);
      }
    } finally {
      setRenewing(false);
    }
  }

  useEffect(() => {
    const supabase = createClient();
    checkSession();

    intervalRef.current = setInterval(checkSession, 5 * 60 * 1000); // every 5 min

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.push('/auth/login');
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 px-4 py-3 shadow-lg max-w-xs">
      <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Session expiring soon</p>
        <p className="text-xs text-amber-700 dark:text-amber-300">Less than 10 minutes remaining</p>
      </div>
      <button
        onClick={handleRenew}
        disabled={renewing}
        className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-200 hover:underline"
      >
        <RefreshCw size={12} className={renewing ? 'animate-spin' : ''} />
        Renew
      </button>
    </div>
  );
}
