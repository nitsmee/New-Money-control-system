'use client';
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

// In-app, styled replacement for window.confirm(). Usage:
//   const confirm = useConfirm();
//   if (!(await confirm({ title:'Delete?', message:'…', confirmLabel:'Delete', danger:true }))) return;

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

// Fallback (only hit if used outside the provider): degrade to native confirm.
const ConfirmContext = createContext<ConfirmFn>(async (o) =>
  typeof window !== 'undefined' ? window.confirm(o.message) : false
);

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    []
  );

  const close = (v: boolean) => { state?.resolve(v); setState(null); };

  // Enter confirms, Escape cancels.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter' && !state.opts.danger) close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'var(--bg-overlay)' }}
          onClick={() => close(false)}
        >
          <div className="card w-full max-w-sm animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="card-p space-y-4">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${state.opts.danger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                  <AlertTriangle size={18} className={state.opts.danger ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{state.opts.title ?? 'Please confirm'}</h3>
                  <p className="text-sm mt-1 whitespace-pre-line break-words" style={{ color: 'var(--text-secondary)' }}>{state.opts.message}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => close(false)} className="btn-md btn-secondary">{state.opts.cancelLabel ?? 'Cancel'}</button>
                <button
                  autoFocus
                  onClick={() => close(true)}
                  className={`btn-md ${state.opts.danger ? 'bg-red-600 text-white hover:bg-red-700' : 'btn-primary'}`}
                >
                  {state.opts.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
