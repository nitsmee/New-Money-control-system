'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
}

// A compact, SEARCHABLE, SCROLLABLE, MULTI-SELECT checkbox dropdown — mirrors the
// CurrencySelect pattern but lets several options be ticked at once. Trigger shows
// the placeholder ("All") when empty, the single label when one is picked, or
// "N selected" otherwise. Closes on outside click + Escape.
export function MultiSelect({ value, onChange, options, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const ql = q.trim().toLowerCase();
  const filtered = ql ? options.filter(o => o.label.toLowerCase().includes(ql)) : options;

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };

  const triggerLabel = value.length === 0
    ? (placeholder ?? 'All')
    : value.length === 1
      ? (options.find(o => o.value === value[0])?.label ?? '1 selected')
      : `${value.length} selected`;

  return (
    <div className={`relative inline-block ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm py-1.5 px-3 rounded-lg border transition-colors hover:border-blue-400"
        style={{ background: 'var(--bg-subtle, #f8fafc)', borderColor: 'var(--border-default, #e2e8f0)', color: 'var(--text-primary)' }}
      >
        <span>{triggerLabel}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-56 rounded-xl border shadow-xl overflow-hidden animate-fade-in-up"
          style={{ background: 'var(--bg-surface, #fff)', borderColor: 'var(--border-default, #e2e8f0)' }}
        >
          <div className="p-2 border-b" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg" style={{ background: 'var(--bg-subtle, #f8fafc)' }}>
              <Search size={13} style={{ color: 'var(--text-muted)' }} />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>No match</p>
            )}
            {filtered.map(o => {
              const checked = value.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span
                    className={`flex items-center justify-center w-4 h-4 rounded border ${checked ? 'bg-blue-600 border-blue-600' : ''}`}
                    style={checked ? undefined : { borderColor: 'var(--border-default, #e2e8f0)' }}
                  >
                    {checked && <Check size={12} className="text-white" />}
                  </span>
                  <span className="flex-1">{o.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs transition-colors hover:text-blue-600"
              style={{ color: 'var(--text-muted)' }}
            >
              Clear
            </button>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{value.length} selected</span>
          </div>
        </div>
      )}
    </div>
  );
}
