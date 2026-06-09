'use client';
import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Goal } from '@/types';
import { calculateAccountBalances, analyzeGoal, formatCurrency, currencySymbol, convertAmount } from '@/lib/utils/calculations';
import { useDisplayCurrency } from '@/lib/useDisplayCurrency';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, Target, CheckCircle, AlertTriangle, Clock, TrendingUp, Flag, Sparkles, SlidersHorizontal } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import { addMonths, format, parseISO, differenceInCalendarMonths } from 'date-fns';
import { useConfirm } from '@/components/ConfirmDialog';

type AllocMode = 'auto' | 'manual';
const ALLOC_MODE_KEY = 'mcs_goal_alloc_mode';

const PRIORITY_LABELS: Record<number, string> = { 1:'Critical', 2:'High', 3:'Medium', 4:'Low', 5:'Optional' };
const EMPTY: Omit<Goal, 'id'|'user_id'|'created_at'|'updated_at'> = {
  name:'', goal_type:'', priority:3, expected_cost:0, planned_purchase_date:undefined,
  amount_allocated:0, monthly_saving_plan:0, payment_plan:'', is_active:true, notes:'',
};

type GoalAnalysisResult = ReturnType<typeof analyzeGoal>;

interface Timeline {
  hasTarget: boolean;
  targetDate: Date | null;
  projectedDate: Date | null;   // null when there's no viable saving plan
  noPlan: boolean;              // can't afford & monthly plan <= 0
  onTrack: boolean;             // affordable now, or projected <= target (or no target)
  // Position of the projected-ready marker along Now -> Target, 0..1.
  // Only meaningful when a target date exists.
  markerPct: number;
  monthsBehind: number;         // months projected is past the target (0 if on track)
}

// Compute the visual timeline for one goal. Pure: depends only on `now`,
// the goal's target date and its analysis (months to ready / affordability).
function computeTimeline(a: GoalAnalysisResult, now: Date = new Date()): Timeline {
  const g = a.goal;
  let targetDate: Date | null = null;
  if (g.planned_purchase_date) {
    try {
      const d = parseISO(g.planned_purchase_date);
      if (!Number.isNaN(d.getTime())) targetDate = d;
    } catch { targetDate = null; }
  }
  const hasTarget = targetDate !== null;

  // No saving plan and not affordable → no projected date.
  const noPlan = !a.can_buy_now && g.monthly_saving_plan <= 0;

  let projectedDate: Date | null;
  if (a.can_buy_now) {
    projectedDate = now;                                   // ready right now
  } else if (noPlan) {
    projectedDate = null;
  } else {
    projectedDate = addMonths(now, Math.max(0, a.months_needed));
  }

  // How far the projected-ready point sits between Now and Target (0..1).
  let markerPct = 0;
  let monthsBehind = 0;
  let onTrack = a.can_buy_now;
  if (hasTarget && targetDate) {
    const totalMonths = Math.max(1, differenceInCalendarMonths(targetDate, now));
    if (projectedDate) {
      const projMonths = differenceInCalendarMonths(projectedDate, now);
      markerPct = Math.min(1, Math.max(0, projMonths / totalMonths));
      onTrack = a.can_buy_now || projectedDate.getTime() <= targetDate.getTime();
      if (!onTrack) {
        monthsBehind = Math.max(0, differenceInCalendarMonths(projectedDate, targetDate));
      }
    } else {
      markerPct = 1;          // no plan → push marker to the far end
      onTrack = false;
    }
  } else {
    // No target set: on-track only if affordable now; otherwise treat as behind.
    onTrack = a.can_buy_now;
  }

  return { hasTarget, targetDate, projectedDate, noPlan, onTrack, markerPct, monthsBehind };
}

export default function GoalsPage() {
  const { goals, accounts, income, transactions, addGoal, updateGoal, removeGoal, settings } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Goal|null>(null);
  const [form, setForm] = useState<typeof EMPTY>({...EMPTY});
  const [saving, setSaving] = useState(false);
  const sb = createClient();
  const confirm = useConfirm();

  // ---- Allocation mode (persisted) ----
  // 'auto'   = shared savings pool is allocated to active goals by priority.
  // 'manual' = each goal uses ONLY its own amount_allocated; the pool is ignored.
  const [allocMode, setAllocMode] = useState<AllocMode>('auto');
  useEffect(() => {
    const saved = localStorage.getItem(ALLOC_MODE_KEY);
    if (saved === 'auto' || saved === 'manual') setAllocMode(saved);
  }, []);
  const changeAllocMode = (mode: AllocMode) => {
    setAllocMode(mode);
    localStorage.setItem(ALLOC_MODE_KEY, mode);
  };

  // ---- Multi-currency wiring ----
  // Goal amounts (expected_cost, amount_allocated, monthly_saving_plan) are
  // stored in the BASE currency. The savings pool sums savings-account balances
  // which may each be in a different native currency. We convert every figure
  // into the chosen display currency before summing/comparing, so the pool,
  // gaps and progress are all consistent. When display === base (or rates are
  // missing) convertAmount is a no-op and output is unchanged.
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;
  const [displayCur] = useDisplayCurrency(base);
  const sym = currencySymbol(displayCur);

  // RAW balances — kept so each account's native currency is known for conversion.
  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions, rates, base), [accounts, income, transactions, rates, base]);
  // Each contributing account balance converted from its native currency to display.
  const savingsBalances = useMemo(
    () => balances
      .filter(b => !b.is_credit_card && b.account.is_active && b.account.include_in_goal_savings)
      .map(b => ({ account: b.account, displayBalance: convertAmount(b.balance, b.account.currency || base, displayCur, rates, base) })),
    [balances, base, displayCur, rates]
  );
  const totalSavings = useMemo(() => savingsBalances.reduce((s,b) => s+b.displayBalance, 0), [savingsBalances]);
  // Same pool expressed in the BASE currency — used by the form (whose inputs
  // are base-currency values). Identical to totalSavings when display === base.
  const totalSavingsBase = useMemo(
    () => balances
      .filter(b => !b.is_credit_card && b.account.is_active && b.account.include_in_goal_savings)
      .reduce((s,b) => s + convertAmount(b.balance, b.account.currency || base, base, rates, base), 0),
    [balances, base, rates]
  );
  // Goal monetary fields converted base -> display so analyzeGoal compares like with like.
  const activeGoals = useMemo(
    () => goals
      .filter(g => g.is_active)
      .sort((a,b) => a.priority - b.priority)
      .map(g => ({
        ...g,
        expected_cost: convertAmount(g.expected_cost, base, displayCur, rates, base),
        amount_allocated: convertAmount(g.amount_allocated, base, displayCur, rates, base),
        monthly_saving_plan: convertAmount(g.monthly_saving_plan, base, displayCur, rates, base),
      })),
    [goals, base, displayCur, rates]
  );
  const goalAnalyses = useMemo(() => {
    // Allocate savings pool sequentially by priority so goals don't all
    // compete against the same full pool — buying goal #1 leaves less for #2.
    // If a goal has amount_allocated > 0, use that dedicated amount instead
    // of drawing from the shared pool.
    // In 'manual' mode the shared pool is ignored entirely: each goal sees
    // ONLY its own amount_allocated (so 0-allocated goals show 0 available).
    let remainingPool = totalSavings;
    return activeGoals.map(g => {
      let available: number;
      let allocSource: 'pool' | 'manual' | 'none';
      if (allocMode === 'manual') {
        available = g.amount_allocated > 0 ? g.amount_allocated : 0;
        allocSource = g.amount_allocated > 0 ? 'manual' : 'none';
      } else if (g.amount_allocated > 0) {
        available = g.amount_allocated;
        allocSource = 'manual';
      } else {
        available = remainingPool;
        allocSource = 'pool';
      }
      const analysis = analyzeGoal(g, available);
      // Deduct this goal's cost from the shared pool only if it draws from it
      // (auto mode, no dedicated allocation, and it's actually affordable now).
      if (allocMode === 'auto' && g.amount_allocated <= 0 && analysis.can_buy_now) {
        remainingPool = Math.max(0, remainingPool - g.expected_cost);
      }
      // What the card should report as "allocated to this goal".
      const allocated = allocSource === 'manual' ? g.amount_allocated : analysis.available_saving;
      return { ...analysis, allocSource, allocated, timeline: computeTimeline(analysis) };
    });
  }, [activeGoals, totalSavings, allocMode]);

  // Pool still unallocated after auto sequential allocation (auto mode only).
  const unallocatedPool = useMemo(() => {
    if (allocMode !== 'auto') return totalSavings;
    let remaining = totalSavings;
    for (const g of activeGoals) {
      if (g.amount_allocated <= 0 && remaining >= g.expected_cost) {
        remaining = Math.max(0, remaining - g.expected_cost);
      }
    }
    return remaining;
  }, [activeGoals, totalSavings, allocMode]);

  const openNew = () => { setEditing(null); setForm({...EMPTY}); setShowForm(true); };
  const openEdit = (g: Goal) => {
    // Card goals are converted to the display currency for presentation, so look
    // up the original (base-currency) goal from the store and edit THAT — the
    // form and the saved payload must always be in the base currency.
    const orig = goals.find(x => x.id === g.id) ?? g;
    setEditing(orig);
    setForm({ name:orig.name, goal_type:orig.goal_type??'', priority:orig.priority, expected_cost:orig.expected_cost, planned_purchase_date:orig.planned_purchase_date??undefined, amount_allocated:orig.amount_allocated, monthly_saving_plan:orig.monthly_saving_plan, payment_plan:orig.payment_plan??'', is_active:orig.is_active, notes:orig.notes??'' });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.expected_cost) { toast.error('Name and expected cost are required'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const payload = { ...form, expected_cost:+form.expected_cost, amount_allocated:+form.amount_allocated, monthly_saving_plan:+form.monthly_saving_plan, priority:+form.priority, user_id:user.id, planned_purchase_date:form.planned_purchase_date||null };
      if (editing) {
        const { data, error } = await sb.from('goals').update(payload).eq('id',editing.id).select().single();
        if (error) throw error;
        updateGoal(editing.id, data);
        toast.success('Goal updated');
      } else {
        const { data, error } = await sb.from('goals').insert(payload).select().single();
        if (error) throw error;
        addGoal(data);
        toast.success('Goal added');
      }
      setShowForm(false);
    } catch (e:any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const handleDelete = async (g: Goal) => {
    if (!(await confirm({ title:'Delete goal?', message:`Delete goal "${g.name}"?`, confirmLabel:'Delete', danger:true }))) return;
    try {
      const { error } = await sb.from('goals').delete().eq('id',g.id);
      if (error) throw error;
      removeGoal(g.id);
      toast.success('Goal deleted');
    } catch (e:any) { toast.error(e.message); }
  };

  const riskBadge = (risk: string) => {
    if (risk==='safe') return 'badge-green';
    if (risk==='moderate') return 'badge-yellow';
    if (risk==='risky') return 'badge-red';
    return 'badge-gray';
  };
  const riskLabel = (risk: string) => ({ safe:'✓ Safe', moderate:'⚠ Moderate', risky:'! Risky', not_ready:'× Not Ready' }[risk] ?? risk);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Goals</h1>
          <p className="text-sm" style={{ color:'var(--text-secondary)' }}>Plan future purchases — can you afford them?</p>
        </div>
        <button onClick={openNew} className="btn-md btn-primary"><Plus size={16}/> Add Goal</button>
      </div>

      {/* Allocation mode toggle */}
      <div className="card card-p">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} style={{ color:'var(--text-secondary)' }} />
            <div>
              <p className="text-sm font-medium">Allocation mode</p>
              <p className="text-xs" style={{ color:'var(--text-muted)' }}>
                {allocMode === 'auto'
                  ? 'Shared savings pool is split across active goals by priority.'
                  : 'Each goal uses only its own allocated amount; the pool is ignored.'}
              </p>
            </div>
          </div>
          <div className="inline-flex rounded-lg p-0.5 self-start" style={{ background:'var(--bg-subtle)' }} role="tablist" aria-label="Allocation mode">
            {(['auto','manual'] as const).map(m => (
              <button
                key={m}
                role="tab"
                aria-selected={allocMode === m}
                onClick={() => changeAllocMode(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${allocMode === m ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}
              >
                {m === 'auto' ? 'Auto (by priority)' : 'Manual'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Savings Pool Banner */}
      <div className="card card-p bg-gradient-to-r from-blue-50 to-emerald-50 dark:from-blue-900/20 dark:to-emerald-900/20 border-blue-200 dark:border-blue-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color:'var(--text-secondary)' }}>Available Savings Pool</p>
            <p className="text-3xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">{formatCurrency(totalSavings, sym)}</p>
            {allocMode === 'auto' ? (
              <p className="text-xs mt-1" style={{ color:'var(--text-muted)' }}>
                Unallocated after goals: <span className="font-semibold">{formatCurrency(unallocatedPool, sym)}</span> · From accounts marked "Include in Goal Savings"
              </p>
            ) : (
              <p className="text-xs mt-1" style={{ color:'var(--text-muted)' }}>Pool ignored in manual mode · From accounts marked "Include in Goal Savings"</p>
            )}
          </div>
          <div className="text-sm space-y-1">
            {savingsBalances.map(b => (
              <div key={b.account.id} className="flex justify-between gap-6">
                <span style={{ color:'var(--text-secondary)' }}>{b.account.name}</span>
                <span className="font-semibold text-blue-700 dark:text-blue-300">{formatCurrency(b.displayBalance, sym)}</span>
              </div>
            ))}
            {balances.filter(b => b.account.include_in_goal_savings).length === 0 && (
              <p className="text-xs" style={{ color:'var(--text-muted)' }}>No savings accounts configured. Enable "Include in Goal Savings" in Settings → Accounts.</p>
            )}
          </div>
        </div>
      </div>

      {/* Goal Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {goalAnalyses.length === 0 && (
          <div className="col-span-full card card-p text-center py-12">
            <Target size={36} className="mx-auto mb-3 text-slate-300"/>
            <p className="text-sm" style={{ color:'var(--text-muted)' }}>No goals yet. Add your first goal to see if you can afford it.</p>
          </div>
        )}
        {goalAnalyses.map(({ goal:g, available_saving, remaining_gap, can_buy_now, months_needed, risk_level, suggested_action, progress_percent, allocSource, allocated, timeline }) => (
          <div key={g.id} className={`card card-p group relative overflow-hidden ${can_buy_now ? 'border-emerald-200 dark:border-emerald-700' : ''}`}>
            {can_buy_now && <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/10 rounded-bl-full"/>}
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`badge text-[10px] ${riskBadge(risk_level)}`}>{riskLabel(risk_level)}</span>
                  <span className="badge badge-gray text-[10px]">{PRIORITY_LABELS[g.priority]}</span>
                </div>
                <h3 className="font-bold text-base">{g.name}</h3>
                {g.goal_type && <p className="text-xs" style={{ color:'var(--text-muted)' }}>{g.goal_type}</p>}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openEdit(g)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13}/></button>
                <button onClick={() => handleDelete(g)} className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={13}/></button>
              </div>
            </div>

            {/* Radial progress */}
            <div className="flex items-center gap-4 my-3">
              <div className="w-20 h-20 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" data={[{ value: progress_percent, fill: can_buy_now ? '#22c55e' : risk_level === 'moderate' ? '#f59e0b' : '#3b82f6' }]} startAngle={90} endAngle={-270}>
                    <RadialBar dataKey="value" cornerRadius={4} background={{ fill: 'var(--bg-subtle)' }} />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center -ml-2">
                <p className={`text-xl font-bold ${can_buy_now ? 'text-emerald-600' : 'text-blue-600'}`}>{progress_percent.toFixed(0)}%</p>
                <p className="text-xs" style={{ color:'var(--text-muted)' }}>saved</p>
              </div>
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex justify-between"><span style={{ color:'var(--text-muted)' }}>Target Cost</span><span className="font-semibold">{formatCurrency(g.expected_cost, sym)}</span></div>
                <div className="flex justify-between"><span style={{ color:'var(--text-muted)' }}>Available</span><span className="font-semibold text-blue-600">{formatCurrency(available_saving, sym)}</span></div>
                <div className="flex justify-between"><span style={{ color:'var(--text-muted)' }}>Remaining Gap</span><span className={`font-semibold ${remaining_gap > 0 ? 'amount-negative' : 'amount-positive'}`}>{remaining_gap > 0 ? `-${formatCurrency(remaining_gap, sym)}` : 'Ready!'}</span></div>
              </div>
            </div>

            <div className="space-y-1.5 text-xs mb-3" style={{ color:'var(--text-secondary)' }}>
              <div className="flex justify-between gap-2">
                <span>Allocated</span>
                <span className="font-medium text-right">
                  {formatCurrency(allocated, sym)}{' '}
                  <span style={{ color:'var(--text-muted)' }}>
                    {allocSource === 'manual' ? '(manual)' : allocSource === 'pool' ? '(from pool)' : '(none)'}
                  </span>
                </span>
              </div>
              {g.monthly_saving_plan > 0 && <div className="flex justify-between"><span>Monthly Saving Plan</span><span className="font-medium">{formatCurrency(g.monthly_saving_plan, sym)}</span></div>}
              {!can_buy_now && months_needed < 9999 && (
                <div className="flex justify-between"><span>Months Needed</span><span className="font-medium">{months_needed} months (~{(months_needed/12).toFixed(1)} yrs)</span></div>
              )}
              {g.planned_purchase_date && <div className="flex justify-between"><span>Target Date</span><span className="font-medium">{g.planned_purchase_date}</span></div>}
            </div>

            {/* Visual timeline: Now → Target with a projected-ready marker */}
            <GoalTimeline timeline={timeline} progress={progress_percent} canBuyNow={can_buy_now} />


            <div className={`rounded-lg p-2.5 text-xs ${can_buy_now ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : risk_level === 'not_ready' ? 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'}`}>
              <div className="flex items-start gap-1.5">
                {can_buy_now ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5"/> : months_needed < 12 ? <Clock size={13} className="flex-shrink-0 mt-0.5"/> : <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>}
                <span>{suggested_action}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'var(--bg-overlay)' }}>
          <div className="card w-full max-w-xl max-h-[92vh] overflow-y-auto animate-fade-in-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Goal' : 'Add Goal'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group col-span-2">
                  <label className="form-label">Goal Name *</label>
                  <input type="text" className="form-input" placeholder="e.g. New Car, iPhone 16" value={form.name} onChange={e => setForm({...form, name:e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Goal Type</label>
                  <input type="text" className="form-input" placeholder="e.g. Car, Travel, TV…" value={form.goal_type} onChange={e => setForm({...form, goal_type:e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={form.priority} onChange={e => setForm({...form, priority:+e.target.value})}>
                    {[1,2,3,4,5].map(p => <option key={p} value={p}>{p} — {PRIORITY_LABELS[p]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Expected Cost *</label>
                  <input type="number" className="form-input" placeholder="0" value={form.expected_cost||''} onChange={e => setForm({...form, expected_cost:+e.target.value})} min="0" step="1000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount Already Allocated</label>
                  <input type="number" className="form-input" placeholder="0" value={form.amount_allocated||''} onChange={e => setForm({...form, amount_allocated:+e.target.value})} min="0" step="1000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Monthly Saving Plan</label>
                  <input type="number" className="form-input" placeholder="0" value={form.monthly_saving_plan||''} onChange={e => setForm({...form, monthly_saving_plan:+e.target.value})} min="0" />
                  {form.monthly_saving_plan > 0 && form.expected_cost > totalSavingsBase && (
                    <p className="form-hint">~{Math.ceil((form.expected_cost - totalSavingsBase) / form.monthly_saving_plan)} months to go</p>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Target Purchase Date</label>
                  <input type="date" className="form-input" value={form.planned_purchase_date??''} onChange={e => setForm({...form, planned_purchase_date:e.target.value||undefined})} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Payment Plan / Notes</label>
                <textarea className="form-textarea" placeholder="e.g. 20% down payment, rest on loan…" value={form.payment_plan||''} onChange={e => setForm({...form, payment_plan:e.target.value})} rows={2} />
              </div>
              <div className="form-group">
                <label className="form-label">Additional Notes</label>
                <textarea className="form-textarea" placeholder="Optional" value={form.notes||''} onChange={e => setForm({...form, notes:e.target.value})} rows={2} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={form.is_active} onChange={e => setForm({...form, is_active:e.target.checked})} />
                Active Goal
              </label>
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-md btn-primary">
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : <Check size={16}/>}
                {saving ? 'Saving…' : editing ? 'Update' : 'Add Goal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact Now → Target timeline with a projected-ready marker (★) and a
// progress fill. Green when on track / affordable, amber/red when behind or
// when there's no saving plan / no target. Designed to wrap cleanly at ~360px.
function GoalTimeline({ timeline, progress, canBuyNow }: { timeline: Timeline; progress: number; canBuyNow: boolean }) {
  const { hasTarget, targetDate, projectedDate, noPlan, onTrack, markerPct, monthsBehind } = timeline;
  const ok = onTrack || canBuyNow;
  const barColor = ok ? '#22c55e' : '#f59e0b';

  const projectedLabel = noPlan
    ? 'No saving plan — set a monthly plan'
    : canBuyNow
      ? 'Ready now'
      : projectedDate
        ? `Ready ~ ${format(projectedDate, 'MMM yyyy')}`
        : '—';

  const statusLine = canBuyNow
    ? 'Affordable now'
    : !hasTarget
      ? projectedLabel
      : noPlan
        ? 'Behind — no saving plan'
        : onTrack
          ? (targetDate ? `On track for ${format(targetDate, 'MMM yyyy')}` : 'On track')
          : `Behind by ~${monthsBehind} month${monthsBehind === 1 ? '' : 's'}`;

  const fillPct = Math.min(100, Math.max(0, progress));

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2 text-[11px] mb-1 flex-wrap" style={{ color:'var(--text-muted)' }}>
        <span>Now</span>
        <span className="text-right">{hasTarget && targetDate ? format(targetDate, 'MMM yyyy') : 'No target set'}</span>
      </div>
      <div className="relative h-2 rounded-full overflow-visible" style={{ background:'var(--bg-subtle)' }}>
        {/* progress fill */}
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width:`${fillPct}%`, background:barColor }} />
        {/* projected-ready marker (only meaningful when a target exists) */}
        {hasTarget && !noPlan && (
          <span
            className="absolute -top-[7px] text-[13px] leading-none select-none"
            style={{ left:`calc(${(markerPct * 100).toFixed(2)}% )`, transform:'translateX(-50%)', color:barColor }}
            title={projectedLabel}
            aria-hidden
          >
            ★
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 text-[11px] flex-wrap" style={{ color: ok ? 'var(--text-secondary)' : '#b45309' }}>
        <Sparkles size={11} className="flex-shrink-0" style={{ color: barColor }} />
        <span className="font-medium">{statusLine}</span>
        {hasTarget && !canBuyNow && !noPlan && (
          <span style={{ color:'var(--text-muted)' }}>· {projectedLabel}</span>
        )}
      </div>
    </div>
  );
}
