'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';

interface Props {
  isOpen: boolean;
  onComplete: () => void;
}

const ACCOUNT_TYPES = ['bank', 'savings', 'credit_card', 'cash'];
const INCOME_SOURCES = ['Salary', 'Business', 'Freelance', 'Other'];

export function OnboardingWizard({ isOpen, onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('bank');
  const [openingBalance, setOpeningBalance] = useState('');

  // Step 2
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeSource, setIncomeSource] = useState('Salary');
  const [incomeDate, setIncomeDate] = useState(new Date().toISOString().slice(0, 10));

  // Step 3
  const [budgetCategory, setBudgetCategory] = useState('Food');
  const [monthlyBudget, setMonthlyBudget] = useState('');

  async function handleFinish() {
    localStorage.setItem('mcs_onboarding_done', 'true');
    onComplete();
  }

  async function saveStep1() {
    if (!accountName.trim()) { toast.error('Enter an account name'); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('accounts').insert({
        name: accountName.trim(),
        account_type: accountType,
        is_active: true,
        include_in_dashboard: true,
        include_in_goal_savings: false,
        is_credit_card: accountType === 'credit_card',
        is_spendable: accountType !== 'savings' && accountType !== 'credit_card',
        sort_order: 0,
        user_id: user.id,
      });
      if (error) throw error;

      if (parseFloat(openingBalance) > 0) {
        const { error: e2 } = await supabase.from('transactions').insert({
          date: new Date().toISOString().slice(0, 10),
          amount: parseFloat(openingBalance),
          type: 'initial_balance',
          category: 'Initial Balance',
          period: new Date().toISOString().slice(0, 7),
          user_id: user.id,
        });
        if (e2) console.warn('Opening balance insert failed:', e2.message);
      }
      toast.success('Account added!');
      setStep(2);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function saveStep2() {
    const amt = parseFloat(incomeAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('income').insert({
        date: incomeDate,
        amount: amt,
        source: incomeSource,
        category: incomeSource,
        to_account_id: null,
        include_in_true_income: true,
        owner_purpose: 'personal',
        user_id: user.id,
      });
      if (error) throw error;
      toast.success('Income added!');
      setStep(3);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function saveStep3() {
    const budget = parseFloat(monthlyBudget);
    if (!budget || budget <= 0) { toast.error('Enter a valid budget amount'); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('budget').insert({
        category: budgetCategory.trim() || 'Food',
        monthly_budget: budget,
        include_in_budget: true,
        is_active: true,
        effective_from: new Date().toISOString().slice(0, 7) + '-01',
        user_id: user.id,
      });
      if (error) throw error;
      toast.success('Budget set!');
      handleFinish();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'var(--bg-overlay)' }}>
      <div className="card w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between card-p border-b" style={{ borderColor: 'var(--border-default)' }}>
          <div>
            <h2 className="font-semibold text-base">
              {step === 1 && 'Welcome! Add your first account'}
              {step === 2 && 'Add your first income'}
              {step === 3 && 'Set a spending limit'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Step {step} of 3</p>
          </div>
          <button onClick={handleFinish} className="btn-icon"><X size={16} /></button>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-4 pb-0">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className="w-2 h-2 rounded-full transition-colors"
              style={{ background: s <= step ? 'var(--brand-500)' : 'var(--bg-muted)' }}
            />
          ))}
        </div>

        <div className="card-p space-y-4 pt-4">
          {/* Step 1 */}
          {step === 1 && (
            <>
              <div className="form-group">
                <label className="form-label">Account Name</label>
                <input className="form-input" placeholder="e.g. SBI Savings" value={accountName} onChange={e => setAccountName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Account Type</label>
                <select className="form-select" value={accountType} onChange={e => setAccountType(e.target.value)}>
                  {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Opening Balance</label>
                <input className="form-input" type="number" min="0" placeholder="0.00" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(2)} className="btn-md btn-secondary">Skip</button>
                <button onClick={saveStep1} disabled={saving} className="btn-md btn-primary flex-1">
                  {saving ? 'Saving…' : 'Save & Continue'}
                </button>
              </div>
            </>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <>
              <div className="form-group">
                <label className="form-label">Amount</label>
                <input className="form-input" type="number" min="0" placeholder="0.00" value={incomeAmount} onChange={e => setIncomeAmount(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Source</label>
                <select className="form-select" value={incomeSource} onChange={e => setIncomeSource(e.target.value)}>
                  {INCOME_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input className="form-input" type="date" value={incomeDate} onChange={e => setIncomeDate(e.target.value)} />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(3)} className="btn-md btn-secondary">Skip</button>
                <button onClick={saveStep2} disabled={saving} className="btn-md btn-primary flex-1">
                  {saving ? 'Saving…' : 'Save & Continue'}
                </button>
              </div>
            </>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <>
              <div className="form-group">
                <label className="form-label">Category</label>
                <input className="form-input" placeholder="Food" value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Monthly Budget</label>
                <input className="form-input" type="number" min="0" placeholder="0.00" value={monthlyBudget} onChange={e => setMonthlyBudget(e.target.value)} />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleFinish} className="btn-md btn-secondary">Skip</button>
                <button onClick={saveStep3} disabled={saving} className="btn-md btn-primary flex-1">
                  {saving ? 'Saving…' : 'Finish Setup'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
