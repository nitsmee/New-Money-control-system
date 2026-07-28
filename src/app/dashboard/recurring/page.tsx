'use client';
import { useState } from 'react';
import FixedExpensesPage from '../fixed-expenses/page';
import RecurringIncomePage from '../recurring-income/page';

// One "Recurring" screen with a Bills | Income toggle. Reuses the two existing
// pages as-is (each keeps its own header, auto-posting and forms) — only one is
// mounted at a time, so behaviour is unchanged.
export default function RecurringPage() {
  const [tab, setTab] = useState<'bills' | 'income'>('bills');
  return (
    <div>
      <div className="inline-flex gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 mb-4">
        {([['bills', 'Bills & Fixed'], ['income', 'Recurring Income']] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === v ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'bills' ? <FixedExpensesPage /> : <RecurringIncomePage />}
    </div>
  );
}
