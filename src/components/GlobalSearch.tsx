'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useAppStore } from '@/lib/store/appStore';

type SearchGroup =
  | 'Transactions'
  | 'Income'
  | 'Accounts'
  | 'Budgets'
  | 'Goals'
  | 'Categories';

const GROUP_ORDER: readonly SearchGroup[] = [
  'Transactions',
  'Income',
  'Accounts',
  'Budgets',
  'Goals',
  'Categories',
];

interface SearchResult {
  id: string;
  label: string;
  sub: string;
  group: SearchGroup;
  href: string;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const { transactions, income, accounts, budgets, goals, categories } = useAppStore();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Allow any visible button (e.g. the header search icon) to open the modal.
  useEffect(() => {
    function handler() {
      setOpen(true);
    }
    window.addEventListener('mcs-open-search', handler);
    return () => window.removeEventListener('mcs-open-search', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setActiveIdx(0);
    }
  }, [open]);

  const results: SearchResult[] = useMemo(() => {
    if (query.trim().length < 1) return [];
    const q = query.toLowerCase();
    const match = (...values: (string | number | null | undefined)[]) =>
      values.some(v => v != null && String(v).toLowerCase().includes(q));
    const out: SearchResult[] = [];

    transactions
      .filter(tx => match(tx.description, tx.category, tx.owner_purpose, tx.notes, tx.amount))
      .slice(0, 5)
      .forEach(tx => out.push({
        id: `tx-${tx.id}`,
        label: tx.description ?? tx.category ?? 'Transaction',
        sub: `${tx.date} · ₹${tx.amount}`,
        group: 'Transactions',
        href: '/dashboard/transactions',
      }));

    income
      .filter(i => match(i.source, i.category, i.description, i.amount))
      .slice(0, 5)
      .forEach(i => out.push({
        id: `inc-${i.id}`,
        label: i.source ?? i.description ?? i.category ?? 'Income',
        sub: `${i.date} · ₹${i.amount}`,
        group: 'Income',
        href: '/dashboard/income',
      }));

    accounts
      .filter(a => match(a.name))
      .slice(0, 5)
      .forEach(a => out.push({
        id: `ac-${a.id}`,
        label: a.name,
        sub: a.account_type,
        group: 'Accounts',
        href: '/dashboard/settings',
      }));

    budgets
      .filter(b => match(b.category))
      .slice(0, 5)
      .forEach(b => out.push({
        id: `bud-${b.id}`,
        label: b.category,
        sub: `₹${b.monthly_budget}/mo`,
        group: 'Budgets',
        href: '/dashboard/budget',
      }));

    goals
      .filter(g => match(g.name, g.goal_type))
      .slice(0, 5)
      .forEach(g => out.push({
        id: `goal-${g.id}`,
        label: g.name,
        sub: g.goal_type ?? `₹${g.expected_cost}`,
        group: 'Goals',
        href: '/dashboard/goals',
      }));

    categories
      .filter(c => match(c.name))
      .slice(0, 5)
      .forEach(c => out.push({
        id: `cat-${c.id}`,
        label: c.name,
        sub: c.type,
        group: 'Categories',
        href: '/dashboard/settings',
      }));

    return out;
  }, [query, transactions, income, accounts, budgets, goals, categories]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[activeIdx]) {
        router.push(results[activeIdx].href);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  if (!open) return null;

  const groups = GROUP_ORDER.filter(g => results.some(r => r.group === g));

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="card w-full max-w-lg shadow-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="Search transactions, income, accounts, budgets, goals…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKey}
            style={{ color: 'var(--text-primary)' }}
          />
          <button onClick={() => setOpen(false)} className="btn-icon">
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {query.trim() === '' ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Type to search…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No results found</p>
          ) : (
            groups.map(group => (
              <div key={group}>
                <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{group}</p>
                {results.filter(r => r.group === group).map(r => {
                  const idx = flatIdx++;
                  return (
                    <button
                      key={r.id}
                      className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors"
                      style={{
                        background: idx === activeIdx ? 'var(--bg-subtle)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                      onClick={() => { router.push(r.href); setOpen(false); }}
                      onMouseEnter={() => setActiveIdx(idx)}
                    >
                      <span className="text-sm font-medium">{r.label}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.sub}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Hint */}
        <div className="px-4 py-2 border-t flex gap-3 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <span>↑↓ navigate</span>
          <span>Enter select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
