'use client';
import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Transaction, TransactionType, TRANSACTION_TYPES } from '@/types';
import { formatCurrency, currencySymbol, convertAmount, runningBalanceByEntry } from '@/lib/utils/calculations';
import { useDisplayCurrency } from '@/lib/useDisplayCurrency';
import { format, endOfMonth, startOfMonth, subMonths, startOfYear, endOfYear, subYears } from 'date-fns';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, Upload } from 'lucide-react';
import { DuplicateWarning } from '@/components/DuplicateWarning';
import { QuickAddModal } from '@/components/QuickAddModal';
import { CSVImportModal } from '@/components/CSVImportModal';
import { MultiSelect } from '@/components/MultiSelect';
import { useConfirm } from '@/components/ConfirmDialog';
import { isOnline, offlineQueue } from '@/lib/offline';

const EMPTY = {
  date: new Date().toISOString().split('T')[0],
  amount: 0, description: '', type: 'expense' as TransactionType,
  category: '', owner_purpose: 'Personal',
  from_account_id: '', to_account_id: '', notes: '',
};

// Returns which fields are required/visible per transaction type
function getTypeConfig(type: TransactionType) {
  switch (type) {
    case 'expense':
      return { needsFrom: true, needsTo: false, needsOwner: true, needsCat: true, label: 'Expense' };
    case 'transfer':
      return { needsFrom: true, needsTo: true, needsOwner: false, needsCat: true, label: 'Transfer' };
    case 'credit_card_payment':
      return { needsFrom: true, needsTo: true, needsOwner: false, needsCat: false, label: 'CC Payment', fromLabel: 'Bank Account', toLabel: 'Credit Card' };
    case 'saving':
      return { needsFrom: true, needsTo: true, needsOwner: false, needsCat: true, label: 'Saving', toLabel: 'Save To Account' };
    case 'initial_balance':
      return { needsFrom: false, needsTo: true, needsOwner: false, needsCat: false, label: 'Initial Balance' };
    case 'initial_cc_outstanding':
      return { needsFrom: true, needsTo: false, needsOwner: false, needsCat: false, label: 'Initial CC Outstanding', fromLabel: 'Credit Card' };
    case 'adjustment':
      return { needsFrom: false, needsTo: true, needsOwner: false, needsCat: false, label: 'Adjustment' };
    default:
      return { needsFrom: true, needsTo: false, needsOwner: true, needsCat: true, label: 'Transaction' };
  }
}

const TYPE_COLOR: Record<TransactionType, string> = {
  expense: 'badge-red', transfer: 'badge-gray', credit_card_payment: 'badge-yellow',
  saving: 'badge-blue', initial_balance: 'badge-green', initial_cc_outstanding: 'badge-red', adjustment: 'badge-gray',
};

// Quick date-range presets. A custom From/To range covers everything else
// (a single month, several months, a whole year, etc.).
const DATE_PRESETS = ['This Month', 'Last Month', 'Last 3 Months', 'This Year', 'Last Year', 'All Time', 'Custom'];

export default function TransactionsPage() {
  const { transactions, income, accounts, categories, owners, addTransaction, updateTransaction, removeTransaction, settings } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [datePreset, setDatePreset] = useState('This Month');
  // Multi-select filters: empty array = no filter (all). Note these hold the
  // SELECTED values; the dropdown OPTION lists live in `filterCategories` /
  // `filterOwners` memos below.
  const [selTypes, setSelTypes] = useState<string[]>([]);
  const [selCategories, setSelCategories] = useState<string[]>([]);
  const [selAccounts, setSelAccounts] = useState<string[]>([]);
  const [selOwners, setSelOwners] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Duplicate warning
  const [duplicateMatches, setDuplicateMatches] = useState<Transaction[]>([]);
  const [pendingPayload, setPendingPayload] = useState<any | null>(null);
  const [showDupWarning, setShowDupWarning] = useState(false);

  // CSV import
  const [showCSVImport, setShowCSVImport] = useState(false);

  // Quick-add FAB
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const sb = createClient();
  const confirm = useConfirm();
  const sym = settings?.currency_symbol ?? '₹';

  // Multi-currency: each account holds amounts in its own currency. Row amounts
  // are shown in that native currency; period totals (which may mix currencies)
  // are converted into the chosen display currency before summing.
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;
  const [displayCur] = useDisplayCurrency(base);
  const symD = currencySymbol(displayCur);
  const curOf = (id?: string | null) => accounts.find(a => a.id === id)?.currency || base;

  // Bank-statement "balance after" for each row: the primary account's native
  // balance AFTER that entry, computed across the FULL chronological history
  // (not the filtered/paged subset). Keyed by transaction id.
  const runningMap = useMemo(
    () => runningBalanceByEntry(accounts, income, transactions, rates, base),
    [accounts, income, transactions, rates, base]
  );

  const clearFilters = () => { setSearch(''); setSelCategories([]); setSelAccounts([]); setSelOwners([]); setSelTypes([]); };
  // Apply a quick preset → fills the From/To range.
  const applyDatePreset = (p: string) => {
    setDatePreset(p);
    const now = new Date();
    const f = (d: Date) => format(d, 'yyyy-MM-dd');
    if (p === 'This Month') { setFromDate(f(startOfMonth(now))); setToDate(f(endOfMonth(now))); }
    else if (p === 'Last Month') { const d = subMonths(now, 1); setFromDate(f(startOfMonth(d))); setToDate(f(endOfMonth(d))); }
    else if (p === 'Last 3 Months') { setFromDate(f(startOfMonth(subMonths(now, 2)))); setToDate(f(endOfMonth(now))); }
    else if (p === 'This Year') { setFromDate(f(startOfYear(now))); setToDate(f(endOfYear(now))); }
    else if (p === 'Last Year') { const d = subYears(now, 1); setFromDate(f(startOfYear(d))); setToDate(f(endOfYear(d))); }
    else if (p === 'All Time') { setFromDate(''); setToDate(''); }
    // 'Custom' keeps whatever From/To are currently set.
  };
  const toggleSort = (key: 'date' | 'amount') => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };
  const sortArrow = (key: 'date' | 'amount') => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const cfg = getTypeConfig(form.type);
  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts]);
  const ccAccounts = useMemo(() => accounts.filter(a => a.is_active && a.is_credit_card), [accounts]);
  const nonCcAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);
  const expenseCategories = useMemo(() => categories.filter(c => (c.type === 'expense' || c.type === 'transfer' || c.type === 'saving' || c.type === 'all') && c.is_active), [categories]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);

  // Distinct values actually present in the data — power the filter dropdowns.
  const filterCategories = useMemo(() => Array.from(new Set(transactions.map(t => t.category).filter(Boolean) as string[])).sort(), [transactions]);
  const filterOwners = useMemo(() => Array.from(new Set(transactions.map(t => t.owner_purpose).filter(Boolean) as string[])).sort(), [transactions]);

  // Amount of a transaction converted into the display currency (source currency
  // = its from-account, falling back to to-account). Used for sums + sorting.
  const convDisp = useMemo(() => {
    const curById = (id?: string | null) => accounts.find(a => a.id === id)?.currency || base;
    return (t: Transaction) => convertAmount(t.amount, curById(t.from_account_id ?? t.to_account_id), displayCur, rates, base);
  }, [accounts, displayCur, rates, base]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = transactions.filter(t => {
      if (fromDate && t.date < fromDate) return false;
      if (toDate && t.date > toDate) return false;
      if (!(selTypes.length === 0 || selTypes.includes(t.type))) return false;
      if (!(selCategories.length === 0 || (t.category && selCategories.includes(t.category)))) return false;
      if (!(selAccounts.length === 0 || (t.from_account_id && selAccounts.includes(t.from_account_id)) || (t.to_account_id && selAccounts.includes(t.to_account_id)))) return false;
      if (!(selOwners.length === 0 || (t.owner_purpose && selOwners.includes(t.owner_purpose)))) return false;
      if (q) {
        const hay = `${t.description ?? ''} ${t.category ?? ''} ${t.owner_purpose ?? ''} ${t.notes ?? ''} ${t.amount}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      const cmp = sortKey === 'amount' ? convDisp(a) - convDisp(b) : a.date.localeCompare(b.date);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [transactions, fromDate, toDate, selTypes, selCategories, selAccounts, selOwners, search, sortKey, sortDir, convDisp]);

  // Client-side pagination of the rendered rows. `filtered` stays the full
  // filtered set (so summary sums + bulk operations cover everything); only the
  // table body maps over `paged`. A very large pageSize means "All".
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(
    () => (pageSize >= 100000 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)),
    [filtered, page, pageSize]
  );

  // Reset to page 1 whenever the filtered set or page size changes.
  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, selTypes, selCategories, selAccounts, selOwners, search, sortKey, sortDir, pageSize]);

  // Summary of the currently-filtered rows (all amounts converted to display
  // currency). Drives the count + per-type sums + filtered total.
  const totals = useMemo(() => {
    let expense = 0, saving = 0, cc_payment = 0, transfer = 0, total = 0;
    for (const t of filtered) {
      const v = convDisp(t);
      total += v;
      if (t.type === 'expense') expense += v;
      else if (t.type === 'saving') saving += v;
      else if (t.type === 'credit_card_payment') cc_payment += v;
      else if (t.type === 'transfer') transfer += v;
    }
    return { count: filtered.length, expense, saving, cc_payment, transfer, total };
  }, [filtered, convDisp]);

  // Sum of the rows the user has ticked (across all data, not just this page).
  const selectedSum = useMemo(
    () => transactions.filter(t => selectedIds.has(t.id)).reduce((s, t) => s + convDisp(t), 0),
    [transactions, selectedIds, convDisp]
  );

  const allVisibleSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirm({ title: 'Move to Recycle Bin?', message: `Move ${selectedIds.size} selected transaction(s) to the Recycle Bin? You can restore them later.`, confirmLabel: 'Move to bin' }))) return;
    setBulkDeleting(true);
    try {
      const ids = [...selectedIds];
      const { error } = await sb.from('transactions').update({ deleted_at: new Date().toISOString() }).in('id', ids);
      if (error) throw error;
      ids.forEach(id => removeTransaction(id));
      setSelectedIds(new Set());
      toast.success(`Moved ${ids.length} to Recycle Bin`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const getFromAccounts = () => {
    if (form.type === 'credit_card_payment') return nonCcAccounts;
    if (form.type === 'initial_cc_outstanding') return ccAccounts;
    if (form.type === 'expense' || form.type === 'saving' || form.type === 'transfer') return activeAccounts;
    return activeAccounts;
  };
  const getToAccounts = () => {
    if (form.type === 'credit_card_payment') return ccAccounts;
    // Transfers and savings should only go to non-CC accounts; sending a
    // transfer to a credit card is semantically a CC payment and should use
    // the credit_card_payment type instead to avoid double-counting.
    if (form.type === 'saving' || form.type === 'transfer') return nonCcAccounts;
    return activeAccounts;
  };

  // A category can carry a default "from" account (set in Settings → Categories).
  // This resolves it, but only if that account is still active.
  const defaultFromForCategory = (catName: string): string | null => {
    const cat = categories.find(c => c.name === catName);
    const def = cat?.default_account_id;
    return def && accounts.some(a => a.id === def && a.is_active) ? def : null;
  };

  const openNew = () => {
    setEditing(null);
    const firstCat = expenseCategories[0]?.name ?? '';
    setForm({ ...EMPTY, from_account_id: defaultFromForCategory(firstCat) ?? (nonCcAccounts[0]?.id ?? ''), category: firstCat, owner_purpose: activeOwners[0]?.name ?? 'Personal' });
    setShowDupWarning(false);
    setPendingPayload(null);
    setDuplicateMatches([]);
    setShowForm(true);
  };
  const openEdit = (tx: Transaction) => {
    setEditing(tx);
    setForm({ date: tx.date, amount: tx.amount, description: tx.description ?? '', type: tx.type, category: tx.category ?? '', owner_purpose: tx.owner_purpose ?? 'Personal', from_account_id: tx.from_account_id ?? '', to_account_id: tx.to_account_id ?? '', notes: tx.notes ?? '' });
    setShowDupWarning(false);
    setPendingPayload(null);
    setDuplicateMatches([]);
    setShowForm(true);
  };

  const validate = () => {
    if (!form.date || !form.amount || form.amount <= 0) { toast.error('Date and amount are required'); return false; }
    if (cfg.needsFrom && !form.from_account_id) { toast.error(`Please select ${cfg.fromLabel ?? 'From Account'}`); return false; }
    if (cfg.needsTo && !form.to_account_id) { toast.error(`Please select ${cfg.toLabel ?? 'To Account'}`); return false; }
    // A movement can't have the same source and destination account.
    if (cfg.needsFrom && cfg.needsTo && form.from_account_id && form.from_account_id === form.to_account_id) {
      toast.error('From and To accounts must be different'); return false;
    }
    if (form.type === 'credit_card_payment') {
      const toAcc = accounts.find(a => a.id === form.to_account_id);
      if (!toAcc?.is_credit_card) { toast.error('To Account must be a Credit Card for bill payments'); return false; }
      const fromAcc = accounts.find(a => a.id === form.from_account_id);
      if (fromAcc?.is_credit_card) { toast.error('Payment source must be a bank/cash account, not a credit card'); return false; }
    }
    if (form.type === 'initial_balance' && form.to_account_id) {
      const existing = transactions.find(t => t.type === 'initial_balance' && t.to_account_id === form.to_account_id && t.id !== editing?.id);
      if (existing) { toast.error('This account already has an Initial Balance. Edit that entry or use an Adjustment instead.'); return false; }
    }
    return true;
  };

  const doInsert = async (payload: any) => {
    if (isOnline()) {
      const { data, error } = await sb.from('transactions').insert(payload).select().single();
      if (error) throw error;
      addTransaction(data);
      toast.success('Transaction added');
    } else {
      offlineQueue.enqueue({ id: payload.id, table: 'transactions', payload, createdAt: Date.now() });
      const now = new Date().toISOString();
      addTransaction({ ...payload, created_at: now, updated_at: now } as Transaction);
      toast('Saved offline — will sync when you reconnect', { icon: '📴' });
    }
    setShowForm(false);
    setShowDupWarning(false);
    setPendingPayload(null);
    setDuplicateMatches([]);
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const period = form.date.slice(0, 7);
      const payload = {
        ...form, amount: +form.amount, user_id: user.id, period,
        from_account_id: form.from_account_id || null,
        to_account_id: form.to_account_id || null,
        category: form.category || null,
        owner_purpose: form.owner_purpose || null,
      };
      if (editing) {
        const { data, error } = await sb.from('transactions').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        updateTransaction(editing.id, data);
        toast.success('Transaction updated');
        setShowForm(false);
      } else {
        // New rows get a client-generated id so the same row can be queued
        // offline and later upserted idempotently. Also flag auto-fixed-expense
        // as false (manual entry).
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const addPayload = { ...payload, id, is_fixed_expense_auto: false };
        // Duplicate check (new transactions only)
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const dateStr = threeDaysAgo.toISOString().split('T')[0];
        const matches = transactions.filter(t =>
          t.amount === +form.amount &&
          t.date >= dateStr &&
          t.type === form.type &&
          t.category === form.category
        );
        if (matches.length > 0) {
          setDuplicateMatches(matches);
          setPendingPayload(addPayload);
          setShowDupWarning(true);
          setSaving(false);
          return;
        }
        await doInsert(addPayload);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: 'Move to Recycle Bin?', message: 'Move this transaction to the Recycle Bin? You can restore it later.', confirmLabel: 'Move to bin' }))) return;
    setDeleting(id);
    try {
      const { error } = await sb.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      removeTransaction(id);
      toast.success('Moved to Recycle Bin');
    } catch (e: any) { toast.error(e.message); } finally { setDeleting(null); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Daily entries — expenses, transfers, savings, CC payments</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCSVImport(true)} className="btn-md btn-secondary"><Upload size={16} /> Import CSV</button>
          <button onClick={openNew} className="btn-md btn-primary"><Plus size={16} /> Add Transaction</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card card-p space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search description, category, amount…"
            className="form-input text-sm py-1.5 px-3 flex-1 min-w-[180px]"
          />
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={datePreset} onChange={e => applyDatePreset(e.target.value)} title="Quick date range">
            {DATE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" className="form-input text-sm py-1.5 px-2 w-auto" value={fromDate} onChange={e => { setFromDate(e.target.value); setDatePreset('Custom'); }} title="From date" />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>to</span>
          <input type="date" className="form-input text-sm py-1.5 px-2 w-auto" value={toDate} onChange={e => { setToDate(e.target.value); setDatePreset('Custom'); }} title="To date" />
          <MultiSelect
            value={selTypes}
            onChange={setSelTypes}
            options={TRANSACTION_TYPES.map(t => ({ value: t.value, label: t.label }))}
            placeholder="All Types"
          />
          <MultiSelect
            value={selCategories}
            onChange={setSelCategories}
            options={filterCategories.map(c => ({ value: c, label: c }))}
            placeholder="All Categories"
          />
          <MultiSelect
            value={selAccounts}
            onChange={setSelAccounts}
            options={accounts.map(a => ({ value: a.id, label: a.name }))}
            placeholder="All Accounts"
          />
          <MultiSelect
            value={selOwners}
            onChange={setSelOwners}
            options={filterOwners.map(o => ({ value: o, label: o }))}
            placeholder="All Owners"
          />
          {(search || selCategories.length > 0 || selAccounts.length > 0 || selOwners.length > 0 || selTypes.length > 0) && (
            <button onClick={clearFilters} className="btn-md btn-secondary text-xs py-1.5 px-3">Clear filters</button>
          )}
        </div>

        {/* Summary of filtered results */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs pt-2 border-t border-slate-100 dark:border-slate-700" style={{ color: 'var(--text-muted)' }}>
          <span><strong style={{ color: 'var(--text-primary)' }}>{totals.count}</strong> transaction{totals.count === 1 ? '' : 's'}</span>
          {totals.expense > 0 && <span>Expense: <strong className="amount-negative">{formatCurrency(totals.expense, symD)}</strong></span>}
          {totals.saving > 0 && <span>Savings: <strong className="text-blue-600">{formatCurrency(totals.saving, symD)}</strong></span>}
          {totals.cc_payment > 0 && <span>CC Paid: <strong className="text-amber-600">{formatCurrency(totals.cc_payment, symD)}</strong></span>}
          {totals.transfer > 0 && <span>Transfers: <strong>{formatCurrency(totals.transfer, symD)}</strong></span>}
          <span>Filtered total: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(totals.total, symD)}</strong></span>
          <span className="opacity-70">(in {displayCur})</span>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-sm">
          <span className="font-medium text-blue-800 dark:text-blue-200">
            {selectedIds.size} selected · sum <strong>{formatCurrency(selectedSum, symD)}</strong>
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="btn-md bg-red-600 text-white hover:bg-red-700 text-xs py-1.5 px-3 rounded-lg disabled:opacity-60"
          >
            {bulkDeleting ? 'Deleting…' : 'Delete Selected'}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="btn-md btn-secondary text-xs py-1.5 px-3 rounded-lg"
          >
            Clear
          </button>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto animate-fade-in-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Transaction' : 'Add Transaction'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Type selector */}
              <div className="form-group">
                <label className="form-label">Transaction Type *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TRANSACTION_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm({ ...form, type: t.value, from_account_id: '', to_account_id: '', category: '', owner_purpose: 'Personal' })}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${form.type === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-300'}`}
                    >{t.label}</button>
                  ))}
                </div>
                {/* Helper text */}
                <p className="form-hint mt-1">
                  {form.type === 'expense' && 'Records money spent. Debits the From Account.'}
                  {form.type === 'transfer' && 'Moves money between accounts (e.g. cash withdrawal). No expense counted.'}
                  {form.type === 'credit_card_payment' && 'Pay a credit card bill. Bank decreases, CC outstanding decreases.'}
                  {form.type === 'saving' && 'Move money to savings. Source decreases, savings increases.'}
                  {form.type === 'initial_balance' && 'Set opening balance for a normal account.'}
                  {form.type === 'initial_cc_outstanding' && 'Set existing credit card balance (what you already owe).'}
                  {form.type === 'adjustment' && 'Manual balance correction.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Date *</label>
                  <input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount *</label>
                  <input type="number" className="form-input" placeholder="0.00" value={form.amount || ''} onChange={e => setForm({ ...form, amount: +e.target.value })} min="0.01" step="0.01" />
                  {(() => {
                    // Display-only hint: the stored amount is always in the
                    // selected account's own currency (from-account if present,
                    // otherwise the to-account).
                    const acctId = form.from_account_id || form.to_account_id;
                    const cur = curOf(acctId);
                    return <p className="form-hint mt-1">Amount is in {currencySymbol(cur)} {cur}</p>;
                  })()}
                </div>
              </div>

              {cfg.needsFrom && (
                <div className="form-group">
                  <label className="form-label">{cfg.fromLabel ?? 'From Account'} *</label>
                  <select className="form-select" value={form.from_account_id} onChange={e => setForm({ ...form, from_account_id: e.target.value })}>
                    <option value="">Select account…</option>
                    {getFromAccounts().map(a => <option key={a.id} value={a.id}>{a.name}{a.is_credit_card ? ' (CC)' : ''}</option>)}
                  </select>
                </div>
              )}

              {cfg.needsTo && (
                <div className="form-group">
                  <label className="form-label">{cfg.toLabel ?? 'To Account'} *</label>
                  <select className="form-select" value={form.to_account_id} onChange={e => setForm({ ...form, to_account_id: e.target.value })}>
                    <option value="">Select account…</option>
                    {getToAccounts().map(a => <option key={a.id} value={a.id}>{a.name}{a.is_credit_card ? ' (CC)' : ''}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {cfg.needsCat && (
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select className="form-select" value={form.category} onChange={e => {
                      const catName = e.target.value;
                      setForm(f => {
                        const next = { ...f, category: catName };
                        const def = defaultFromForCategory(catName);
                        if (def && getTypeConfig(f.type).needsFrom) next.from_account_id = def;
                        return next;
                      });
                    }}>
                      <option value="">Select…</option>
                      {expenseCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {cfg.needsOwner && (
                  <div className="form-group">
                    <label className="form-label">Owner / Purpose</label>
                    <select className="form-select" value={form.owner_purpose} onChange={e => setForm({ ...form, owner_purpose: e.target.value })}>
                      {activeOwners.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input type="text" className="form-input" placeholder="What was this for?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" placeholder="Optional notes…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 space-y-3">
              {/* Duplicate warning shown above save button */}
              {showDupWarning && (
                <DuplicateWarning
                  matches={duplicateMatches}
                  amount={+form.amount}
                  currencySymbol={sym}
                  onDismiss={() => {
                    setShowDupWarning(false);
                    setPendingPayload(null);
                    setDuplicateMatches([]);
                  }}
                  onConfirm={async () => {
                    if (!pendingPayload) return;
                    setSaving(true);
                    try {
                      await doInsert(pendingPayload);
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setSaving(false);
                    }
                  }}
                />
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-md btn-primary">
                  {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={16} />}
                  {saving ? 'Saving…' : editing ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div className="table-container border-0">
          <table className="data-table">
            <thead><tr>
              <th className="w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 accent-blue-600"
                  title="Select all filtered rows (across all pages)"
                />
              </th>
              <th className="cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('date')} title="Sort by date">Date{sortArrow('date')}</th>
              <th>Description</th><th>Type</th><th>Category</th><th>Owner</th><th>From</th><th>To</th>
              <th className="text-right cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('amount')} title="Sort by amount">Amount{sortArrow('amount')}</th>
              <th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {search || selCategories.length > 0 || selAccounts.length > 0 || selOwners.length > 0 || selTypes.length > 0
                    ? 'No transactions match your filters. Try clearing some.'
                    : 'No transactions for this period. Click "Add Transaction" to start.'}
                </td></tr>
              )}
              {paged.map(tx => {
                const fromAcc = accounts.find(a => a.id === tx.from_account_id);
                const toAcc = accounts.find(a => a.id === tx.to_account_id);
                return (
                  <tr key={tx.id} className={selectedIds.has(tx.id) ? 'bg-blue-50 dark:bg-blue-900/10' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleSelect(tx.id)}
                        className="w-4 h-4 accent-blue-600"
                      />
                    </td>
                    <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{tx.date}</td>
                    <td className="max-w-xs text-sm">{tx.description || tx.category || '—'}</td>
                    <td><span className={`badge text-[10px] ${TYPE_COLOR[tx.type]}`}>{tx.type.replace(/_/g, ' ')}</span></td>
                    <td className="text-xs">{tx.category ?? '—'}</td>
                    <td className="text-xs">{tx.owner_purpose ?? '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{fromAcc?.name ?? '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{toAcc?.name ?? '—'}</td>
                    <td className={`text-right font-semibold text-sm ${tx.type === 'expense' ? 'amount-negative' : tx.type === 'saving' ? 'text-blue-600 dark:text-blue-400' : 'amount-neutral'}`}>
                      {tx.type === 'expense' ? '-' : ''}{formatCurrency(tx.amount, currencySymbol(curOf(tx.from_account_id ?? tx.to_account_id)))}
                      {(() => {
                        const info = runningMap.get(tx.id);
                        if (!info) return null;
                        const label = info.isCreditCard ? 'due' : 'bal';
                        return (
                          <div className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>
                            {label} {formatCurrency(info.running, currencySymbol(info.currency))}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(tx)} aria-label="Edit transaction" className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(tx.id)} disabled={deleting === tx.id} aria-label="Delete transaction" className="btn-icon text-slate-400 hover:text-red-600">
                          {deleting === tx.id ? <span className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>
            Showing{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}
              –{Math.min(page * pageSize, filtered.length)}
            </strong>{' '}
            of <strong style={{ color: 'var(--text-primary)' }}>{filtered.length}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-md btn-secondary text-xs py-1.5 px-3 disabled:opacity-50"
            >
              Prev
            </button>
            <span>Page <strong style={{ color: 'var(--text-primary)' }}>{page}</strong> of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-md btn-secondary text-xs py-1.5 px-3 disabled:opacity-50"
            >
              Next
            </button>
            <select
              className="form-select text-sm py-1.5 px-2 w-auto"
              value={pageSize}
              onChange={e => setPageSize(+e.target.value)}
              title="Rows per page"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={200}>200 / page</option>
              <option value={100000}>All</option>
            </select>
          </div>
        </div>
      </div>

      {/* CSV Import Modal */}
      <CSVImportModal
        isOpen={showCSVImport}
        onClose={() => setShowCSVImport(false)}
        onImported={(count) => {
          toast.success(`Imported ${count} transactions`);
          setShowCSVImport(false);
        }}
      />

      {/* Quick Add Modal */}
      <QuickAddModal
        isOpen={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        onSaved={() => setShowQuickAdd(false)}
      />

      {/* Floating Action Button — stacked ABOVE the Finance Bot (bottom-6) so they never overlap */}
      <button
        onClick={() => setShowQuickAdd(true)}
        className="fixed bottom-24 right-6 z-40 w-14 h-14 rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 flex items-center justify-center transition-all hover:scale-105"
        title="Quick Add Transaction"
      >
        <Plus size={24} />
      </button>
    </div>
  );
}
