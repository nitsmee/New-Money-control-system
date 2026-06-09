'use client';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Transaction, TransactionType } from '@/types';
import { formatCurrency, formatDate, currencySymbol } from '@/lib/utils/calculations';
import toast from 'react-hot-toast';
import { Trash2, Undo2, Loader2 } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';

// Per-type badge colours — mirrors the Transactions page so a row looks the
// same wherever it appears.
const TYPE_COLOR: Record<TransactionType, string> = {
  expense: 'badge-red',
  transfer: 'badge-gray',
  credit_card_payment: 'badge-yellow',
  saving: 'badge-blue',
  initial_balance: 'badge-green',
  initial_cc_outstanding: 'badge-red',
  adjustment: 'badge-gray',
};

// "Deleted" column: a short relative label ("2h ago", "3d ago") falling back to
// an absolute date for anything older than a week, and the formatted date for
// anything unparsable.
function relativeFromNow(iso?: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso.slice(0, 10));
}

export default function RecycleBinPage() {
  const { recycledTransactions, setRecycledTransactions, loadRecycled, addTransaction, accounts, settings } =
    useAppStore();
  const [loading, setLoading] = useState(true);
  // Track per-row in-flight actions so buttons can show a spinner / disable.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const confirm = useConfirm();

  const base = settings?.currency ?? 'INR';

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) {
          toast.error('Not authenticated');
          return;
        }
        await loadRecycled(user.id);
      } catch {
        toast.error('Could not load the recycle bin');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadRecycled]);

  // Amount is shown in the row's NATIVE account currency: the from-account if
  // present, otherwise the to-account, falling back to the base currency.
  const currencyForRow = (tx: Transaction): string => {
    const acctId = tx.from_account_id ?? tx.to_account_id;
    return accounts.find(a => a.id === acctId)?.currency || base;
  };

  const handleRestore = async (tx: Transaction) => {
    setBusyId(tx.id);
    try {
      const { error } = await createClient()
        .from('transactions')
        .update({ deleted_at: null })
        .eq('id', tx.id);
      if (error) throw error;
      addTransaction({ ...tx, deleted_at: null });
      setRecycledTransactions(recycledTransactions.filter(r => r.id !== tx.id));
      toast.success('Restored');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteForever = async (tx: Transaction) => {
    if (!(await confirm({ title: 'Delete forever?', message: 'Permanently delete this transaction? This cannot be undone.', confirmLabel: 'Delete forever', danger: true }))) return;
    setBusyId(tx.id);
    try {
      const { error } = await createClient()
        .from('transactions')
        .delete()
        .eq('id', tx.id);
      if (error) throw error;
      setRecycledTransactions(recycledTransactions.filter(r => r.id !== tx.id));
      toast.success('Permanently deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusyId(null);
    }
  };

  const handleEmptyBin = async () => {
    if (recycledTransactions.length === 0) return;
    if (!(await confirm({ title: 'Empty recycle bin?', message: `Permanently delete all ${recycledTransactions.length} transaction(s)? This cannot be undone.`, confirmLabel: 'Empty bin', danger: true }))) return;
    setEmptying(true);
    try {
      const ids = recycledTransactions.map(r => r.id);
      const { error } = await createClient()
        .from('transactions')
        .delete()
        .in('id', ids);
      if (error) throw error;
      setRecycledTransactions([]);
      toast.success('Recycle bin emptied');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not empty the bin');
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Recycle Bin</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Deleted transactions are kept here until you remove them permanently. Restore anything you need.
          </p>
        </div>
        {recycledTransactions.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleEmptyBin}
              disabled={emptying}
              className="btn-md btn-secondary text-red-600 dark:text-red-400 disabled:opacity-60"
            >
              {emptying
                ? <Loader2 size={16} className="animate-spin" />
                : <Trash2 size={16} />}
              Empty bin
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card card-p flex items-center justify-center gap-3 py-16" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading deleted transactions…</span>
        </div>
      ) : recycledTransactions.length === 0 ? (
        <div className="card card-p text-center py-16 animate-fade-in-up">
          <div className="mx-auto mb-5 w-20 h-20 rounded-full grid place-items-center bg-slate-100 dark:bg-slate-700/40">
            <Trash2 size={36} style={{ color: 'var(--text-muted)' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Recycle bin is empty</h2>
          <p className="text-sm max-w-sm mx-auto" style={{ color: 'var(--text-muted)' }}>
            Deleted transactions will appear here.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="table-container border-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Deleted</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recycledTransactions.map(tx => {
                  const busy = busyId === tx.id;
                  const sym = currencySymbol(currencyForRow(tx));
                  return (
                    <tr key={tx.id}>
                      <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {relativeFromNow(tx.deleted_at)}
                      </td>
                      <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {tx.date}
                      </td>
                      <td className="text-sm max-w-[12rem]">
                        <span className="block truncate">{tx.description || tx.category || tx.type.replace(/_/g, ' ')}</span>
                      </td>
                      <td>
                        <span className={`badge text-[10px] ${TYPE_COLOR[tx.type]}`}>{tx.type.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="text-right font-semibold text-sm whitespace-nowrap amount-neutral">
                        {formatCurrency(tx.amount, sym)}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleRestore(tx)}
                            disabled={busy}
                            className="btn-md btn-secondary text-xs py-1.5 px-3 disabled:opacity-60"
                          >
                            {busy
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Undo2 size={14} />}
                            <span className="hidden sm:inline">Restore</span>
                          </button>
                          <button
                            onClick={() => handleDeleteForever(tx)}
                            disabled={busy}
                            className="btn-md btn-secondary text-xs py-1.5 px-3 text-red-600 dark:text-red-400 disabled:opacity-60"
                          >
                            <Trash2 size={14} />
                            <span className="hidden sm:inline">Delete forever</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
