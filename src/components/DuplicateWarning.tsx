'use client';
import { AlertTriangle, X } from 'lucide-react';
import { Transaction } from '@/types';
import { formatCurrency } from '@/lib/utils/calculations';

interface Props {
  matches: Transaction[];
  amount: number;
  onDismiss: () => void;
  onConfirm: () => void;
  currencySymbol?: string;
}

export function DuplicateWarning({ matches, amount, onDismiss, onConfirm, currencySymbol = '₹' }: Props) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Possible duplicate detected</p>
          <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">Similar transactions found in the last 3 days:</p>
        </div>
        <button onClick={onDismiss} className="btn-icon text-amber-400"><X size={14}/></button>
      </div>
      <div className="space-y-1">
        {matches.slice(0,3).map(tx => (
          <div key={tx.id} className="flex justify-between text-xs text-amber-700 dark:text-amber-300 pl-6">
            <span>{tx.date} · {tx.category ?? tx.description ?? 'Transaction'}</span>
            <span className="font-semibold">{formatCurrency(tx.amount, currencySymbol)}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pl-6">
        <button onClick={onConfirm} className="btn-md btn-secondary text-xs py-1.5">Save Anyway</button>
        <button onClick={onDismiss} className="btn-md btn-primary text-xs py-1.5">Cancel</button>
      </div>
    </div>
  );
}
