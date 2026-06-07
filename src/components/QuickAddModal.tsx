'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/appStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const EXPENSE_CATEGORIES = [
  'Food', 'Transport', 'Shopping', 'Bills', 'Health', 'Entertainment',
  'Education', 'Groceries', 'Fuel', 'Travel', 'Personal Care', 'Other',
];

export function QuickAddModal({ isOpen, onClose, onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'expense' | 'saving'>('expense');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [fromAccountId, setFromAccountId] = useState('');
  const [saving, setSaving] = useState(false);

  const { accounts } = useAppStore();
  const activeAccounts = accounts.filter(a => a.is_active && !a.is_credit_card);

  async function handleSave() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!fromAccountId) {
      toast.error('Select an account');
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('transactions').insert({
        date,
        amount: amt,
        type,
        category,
        from_account_id: fromAccountId,
        period: date.slice(0, 7),
        user_id: user.id,
      });
      if (error) throw error;

      toast.success('Transaction saved');
      onSaved();
      onClose();
      setAmount('');
      setDate(today);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="card w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl"
        style={{ animation: 'slideUp 0.2s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between card-p pb-3 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <h2 className="font-semibold text-base">Quick Add</h2>
          <button onClick={onClose} className="btn-icon"><X size={16} /></button>
        </div>

        <div className="card-p space-y-4">
          {/* Type toggle */}
          <div className="form-group">
            <label className="form-label">Type</label>
            <div className="flex gap-2">
              {(['expense', 'saving'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    type === t
                      ? 'btn-primary'
                      : 'btn-secondary'
                  }`}
                >
                  {t === 'expense' ? 'Expense' : 'Saving'}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              type="date"
              className="form-input"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>

          {/* Amount */}
          <div className="form-group">
            <label className="form-label">Amount</label>
            <input
              type="number"
              className="form-input"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>

          {/* Category */}
          <div className="form-group">
            <label className="form-label">Category</label>
            <select
              className="form-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {EXPENSE_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* From Account */}
          <div className="form-group">
            <label className="form-label">From Account</label>
            <select
              className="form-select"
              value={fromAccountId}
              onChange={e => setFromAccountId(e.target.value)}
            >
              <option value="">Select account…</option>
              {activeAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-md btn-primary w-full"
          >
            {saving ? 'Saving…' : 'Save Transaction'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @media (min-width: 640px) {
          @keyframes slideUp {
            from { transform: scale(0.95); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
        }
      `}</style>
    </div>
  );
}
