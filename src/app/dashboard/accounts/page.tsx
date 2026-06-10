'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Transaction } from '@/types';
import { calculateAccountBalances, accountRole, formatCurrency, formatDate, accountLedger, currencySymbol } from '@/lib/utils/calculations';
import toast from 'react-hot-toast';
import { Plus, X, Check, Receipt, Wallet, PiggyBank, TrendingUp, Users, CreditCard } from 'lucide-react';

type QAType = 'expense' | 'transfer' | 'saving';

// Each account role gets one accent color that drives its icon chip, badge,
// left strip, corner glow and (for cards) the drawer header — so the page reads
// colorful but cohesive rather than monochrome.
const ROLE_META: Record<string, { label: string; Icon: any; color: string }> = {
  cash:        { label: 'Cash',        Icon: Wallet,     color: '#10b981' },
  savings:     { label: 'Savings',     Icon: PiggyBank,  color: '#3b82f6' },
  investment:  { label: 'Investment',  Icon: TrendingUp, color: '#8b5cf6' },
  family:      { label: 'Family',      Icon: Users,      color: '#f59e0b' },
  credit_card: { label: 'Credit card', Icon: CreditCard, color: '#f43f5e' },
};

export default function AccountsPage() {
  const { accounts, income, transactions, categories, owners, addTransaction, settings } = useAppStore();
  const sb = createClient();
  const sym = settings?.currency_symbol ?? '₹';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerView, setDrawerView] = useState<'statement' | 'quickadd'>('statement');
  const [qa, setQa] = useState({
    type: 'expense' as QAType,
    date: new Date().toISOString().split('T')[0],
    amount: 0,
    category: '',
    owner_purpose: 'Personal',
    to_account_id: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions), [accounts, income, transactions]);
  const activeBalances = useMemo(() => balances.filter(b => b.account.is_active), [balances]);
  const balOf = (id: string) => balances.find(b => b.account.id === id);

  const expenseCategories = useMemo(() => categories.filter(c => (c.type === 'expense' || c.type === 'transfer' || c.type === 'saving' || c.type === 'all') && c.is_active), [categories]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);
  const nonCcAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);

  // Order: cash, savings, investment, family, then credit cards.
  const order: Record<string, number> = { cash: 0, savings: 1, investment: 2, family: 3, credit_card: 4 };
  const sortedBalances = useMemo(() =>
    [...activeBalances].sort((a, b) => (order[accountRole(a.account)] ?? 9) - (order[accountRole(b.account)] ?? 9)),
    [activeBalances]
  );

  const selected = selectedId ? balOf(selectedId) : null;
  const selectedAccount = selected?.account ?? null;
  const selMeta = selectedAccount ? (ROLE_META[accountRole(selectedAccount)] ?? ROLE_META.cash) : ROLE_META.cash;
  const SelIcon = selMeta.Icon;

  // Full running-balance statement for the selected account (native currency, oldest → newest).
  const ledger = useMemo(
    () => selectedAccount ? accountLedger(selectedAccount.id, accounts, income, transactions, settings?.exchange_rates, settings?.currency ?? 'INR') : [],
    [selectedAccount, accounts, income, transactions, settings]
  );

  const openAccount = (id: string) => {
    setSelectedId(id);
    setDrawerView('statement');
    setQa({
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      category: expenseCategories[0]?.name ?? '',
      owner_purpose: activeOwners[0]?.name ?? 'Personal',
      to_account_id: '',
      description: '',
    });
  };

  const toOptions = useMemo(() => {
    // For transfer: any other active account. For saving: non-CC accounts (excluding self).
    const pool = qa.type === 'saving' ? nonCcAccounts : accounts.filter(a => a.is_active);
    return pool.filter(a => a.id !== selectedId);
  }, [qa.type, accounts, nonCcAccounts, selectedId]);

  const handleQuickAdd = async () => {
    if (!selectedId) return;
    if (!qa.date || !qa.amount || qa.amount <= 0) { toast.error('Enter a valid amount'); return; }
    if ((qa.type === 'transfer' || qa.type === 'saving') && !qa.to_account_id) { toast.error('Pick a destination account'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const period = qa.date.slice(0, 7);
      const payload = {
        user_id: user.id,
        date: qa.date,
        amount: +qa.amount,
        type: qa.type,
        description: qa.description || null,
        category: qa.category || null,
        owner_purpose: qa.type === 'expense' ? (qa.owner_purpose || null) : null,
        from_account_id: selectedId,
        to_account_id: qa.type === 'expense' ? null : (qa.to_account_id || null),
        notes: null,
        period,
      };
      const { data, error } = await sb.from('transactions').insert(payload).select().single();
      if (error) throw error;
      addTransaction(data);
      toast.success('Transaction added');
      setQa(q => ({ ...q, amount: 0, description: '' }));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const displayBalance = (b: ReturnType<typeof balOf>) => {
    if (!b) return 0;
    return b.is_credit_card ? (b.outstanding ?? 0) : b.balance;
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Tap an account to see its transactions and quickly add a new one</p>
        </div>
      </div>

      {/* Account grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedBalances.length === 0 && (
          <div className="col-span-full card card-p text-center py-10">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No accounts yet. Add accounts in Settings.</p>
          </div>
        )}
        {sortedBalances.map(b => {
          const role = accountRole(b.account);
          const meta = ROLE_META[role] ?? ROLE_META.cash;
          const Icon = meta.Icon;
          const val = displayBalance(b);
          return (
            <button
              key={b.account.id}
              onClick={() => openAccount(b.account.id)}
              className="card card-p text-left relative overflow-hidden group transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:scale-[0.99] animate-fade-in-up"
              style={{
                background: `color-mix(in srgb, ${meta.color} 12%, var(--bg-surface))`,
                borderColor: `color-mix(in srgb, ${meta.color} 28%, var(--border-default))`,
              }}
            >
              {/* Accent strip */}
              <span className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: meta.color }} />
              {/* Soft corner glow */}
              <span className="absolute -top-8 -right-8 w-28 h-28 rounded-full pointer-events-none transition-transform duration-300 group-hover:scale-125" style={{ background: meta.color, opacity: 0.1 }} />
              <div className="relative z-10">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0" style={{ background: `${meta.color}24`, color: meta.color }}>
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate" style={{ color: 'var(--text-primary)' }}>{b.account.name}</p>
                    <span className="badge text-[10px] mt-0.5" style={{ background: `${meta.color}24`, color: meta.color }}>{meta.label}</span>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{b.is_credit_card ? 'Outstanding' : 'Balance'}</p>
                  <p className="text-2xl font-bold tracking-tight mt-0.5" style={{ color: meta.color }}>
                    {formatCurrency(val, sym)}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail modal (centered) */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }} onClick={() => setSelectedId(null)}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in-up rounded-2xl" onClick={e => e.stopPropagation()}>
            {/* Header — soft accent tint matching the account's card */}
            <div
              className="relative overflow-hidden flex items-center justify-between p-5 border-b"
              style={{
                background: `color-mix(in srgb, ${selMeta.color} 12%, var(--bg-surface))`,
                borderColor: `color-mix(in srgb, ${selMeta.color} 24%, var(--border-default))`,
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0" style={{ background: `${selMeta.color}24`, color: selMeta.color }}>
                  <SelIcon size={20} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{selected.account.name}</h2>
                  <p className="text-sm font-medium" style={{ color: selected.is_credit_card ? 'var(--text-danger)' : 'var(--text-secondary)' }}>
                    {selected.is_credit_card ? 'Outstanding ' : 'Balance '}{formatCurrency(displayBalance(selected), sym)}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="btn-icon flex-shrink-0"><X size={18} /></button>
            </div>

            {/* View toggle: Statement | Quick Add */}
            <div className="p-5 pb-0">
              <div className="inline-flex w-full p-1 rounded-xl gap-1" style={{ background: 'var(--bg-subtle, rgba(125,125,125,0.12))' }}>
                {([
                  { id: 'statement', label: 'Statement', Icon: Receipt },
                  { id: 'quickadd', label: 'Quick Add', Icon: Plus },
                ] as const).map(v => {
                  const VIcon = v.Icon;
                  const active = drawerView === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setDrawerView(v.id)}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${active ? 'text-white shadow-sm' : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'}`}
                      style={active ? { background: selMeta.color } : undefined}
                    >
                      <VIcon size={15} /> {v.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {drawerView === 'quickadd' ? (
            /* Quick add */
            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                {(['expense', 'transfer', 'saving'] as QAType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setQa(q => ({ ...q, type: t, to_account_id: '' }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${qa.type === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    {t === 'expense' ? 'Expense' : t === 'transfer' ? 'Transfer' : 'Saving'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" className="form-input" value={qa.date} onChange={e => setQa({ ...qa, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input type="number" className="form-input" placeholder="0" value={qa.amount || ''} min="0.01" step="0.01" onChange={e => setQa({ ...qa, amount: +e.target.value })} />
                </div>
              </div>

              {(qa.type === 'transfer' || qa.type === 'saving') && (
                <div className="form-group">
                  <label className="form-label">{qa.type === 'saving' ? 'Save to' : 'To account'}</label>
                  <select className="form-select" value={qa.to_account_id} onChange={e => setQa({ ...qa, to_account_id: e.target.value })}>
                    <option value="">Select…</option>
                    {toOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-select" value={qa.category} onChange={e => setQa({ ...qa, category: e.target.value })}>
                  <option value="">{qa.type === 'expense' ? 'Select…' : 'Optional'}</option>
                  {expenseCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>

              {qa.type === 'expense' && (
                <div className="form-group">
                  <label className="form-label">Owner / Purpose</label>
                  <select className="form-select" value={qa.owner_purpose} onChange={e => setQa({ ...qa, owner_purpose: e.target.value })}>
                    {activeOwners.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Note</label>
                <input type="text" className="form-input" placeholder="What was this for?" value={qa.description} onChange={e => setQa({ ...qa, description: e.target.value })} />
              </div>

              <button onClick={handleQuickAdd} disabled={saving} className="btn-md btn-primary w-full justify-center">
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={16} />}
                {saving ? 'Saving…' : `Add ${qa.type}`}
              </button>
            </div>
            ) : (
            /* Full running-balance Statement */
            <div className="p-5">
              {(() => {
                  const base = settings?.currency ?? 'INR';
                  const accSym = currencySymbol(selectedAccount?.currency || base);
                  const isCC = !!selected.is_credit_card;
                  const finalRunning = ledger.length ? ledger[ledger.length - 1].running : 0;
                  const ROW_CAP = 300;
                  const display = [...ledger].reverse(); // newest → oldest, keeping each row's own running
                  const capped = display.length > ROW_CAP;
                  const rows = capped ? display.slice(0, ROW_CAP) : display;
                  return (
                    <>
                      <p className="text-sm font-semibold mb-1">Statement</p>
                      {ledger.length === 0 ? (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No entries for this account yet.</p>
                      ) : (
                        <>
                          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                            <span>Opening: {formatCurrency(0, accSym)}</span>
                            <span style={{ color: 'var(--text-muted)' }}>→ … →</span>
                            <span className="font-semibold px-2 py-0.5 rounded-md" style={{ background: isCC ? 'var(--text-danger)' : selMeta.color, color: '#fff' }}>
                              Current: {formatCurrency(finalRunning, accSym)}
                            </span>
                          </div>
                          <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                            This is every entry that affected this account, oldest to newest — the {isCC ? 'Outstanding' : 'Running'} column shows exactly how the current balance was reached.
                          </p>
                          {capped && (
                            <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                              Showing the most recent {ROW_CAP} of {display.length} entries.
                            </p>
                          )}
                          <div className="overflow-y-auto" style={{ maxHeight: '24rem' }}>
                            <table className="w-full text-xs border-collapse">
                              <thead className="sticky top-0" style={{ background: 'var(--bg-card, var(--bg-surface, #fff))' }}>
                                <tr style={{ color: 'var(--text-muted)' }} className="text-left">
                                  <th className="py-1.5 pr-2 font-medium">Date</th>
                                  <th className="py-1.5 pr-2 font-medium">Description</th>
                                  <th className="py-1.5 pr-2 font-medium text-right">Amount</th>
                                  <th className="py-1.5 font-medium text-right">{isCC ? 'Outstanding' : 'Running'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((e, idx) => {
                                  const positive = e.delta >= 0;
                                  return (
                                    <tr key={e.id} className="align-top" style={{ background: idx % 2 === 1 ? 'var(--bg-subtle)' : 'transparent' }}>
                                      <td className="py-2 px-2 whitespace-nowrap rounded-l-md" style={{ color: 'var(--text-secondary)' }}>{formatDate(e.date)}</td>
                                      <td className="py-2 pr-2">
                                        <span className="block truncate max-w-[10rem]">{e.label}</span>
                                        <span className="badge badge-gray text-[9px]">{e.type.replace(/_/g, ' ')}</span>
                                      </td>
                                      <td className="py-2 pr-2 text-right whitespace-nowrap font-semibold" style={{ color: positive ? 'var(--text-success)' : 'var(--text-danger)' }}>
                                        {positive ? '+' : '−'}{formatCurrency(Math.abs(e.delta), accSym)}
                                      </td>
                                      <td className="py-2 px-2 text-right whitespace-nowrap font-bold rounded-r-md" style={{ color: 'var(--text-primary)' }}>{formatCurrency(e.running, accSym)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
