'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { currencyLabel } from '@/lib/utils/calculations';

interface Props {
  value: string;
  onChange: (code: string) => void;
  options: string[];          // currency codes to choose from
  className?: string;
  placeholder?: string;
}

// A compact, SEARCHABLE, SCROLLABLE currency picker. Replaces the long native
// <select> that dumped every currency — type to filter, list is capped and
// scrolls, and labels never repeat the code (uses currencyLabel).
export function CurrencySelect({ value, onChange, options, className, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const ql = q.trim().toLowerCase();
  const filtered = ql ? options.filter(c => currencyLabel(c).toLowerCase().includes(ql)) : options;

  return (
    <div className={`relative inline-block ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm py-1.5 px-3 rounded-lg border transition-colors hover:border-blue-400"
        style={{ background: 'var(--bg-subtle, #f8fafc)', borderColor: 'var(--border-default, #e2e8f0)', color: 'var(--text-primary)' }}
      >
        <span>{value ? currencyLabel(value) : (placeholder ?? 'Select')}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-52 rounded-xl border shadow-xl overflow-hidden animate-fade-in-up"
          style={{ background: 'var(--bg-surface, #fff)', borderColor: 'var(--border-default, #e2e8f0)' }}
        >
          <div className="p-2 border-b" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg" style={{ background: 'var(--bg-subtle, #f8fafc)' }}>
              <Search size={13} style={{ color: 'var(--text-muted)' }} />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search currency…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>No match</p>
            )}
            {filtered.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); setQ(''); }}
                className="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/30"
                style={{ color: 'var(--text-primary)' }}
              >
                <span>{currencyLabel(c)}</span>
                {c === value && <Check size={14} className="text-blue-600 dark:text-blue-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
