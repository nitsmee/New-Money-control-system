// ============================================================
// AUTO-PROCESSING for fixed expenses
// Generates the real transactions for every due date a fixed
// expense has reached — back-filling any months that were missed
// and posting each new month as its due date arrives.
//
// Idempotent: before creating an entry for a given month it checks
// whether one already exists (by fixed_expense_id + period), so
// running it many times never creates duplicates.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { FixedExpense, Transaction, TransactionType } from '@/types';
import { getDueOccurrences } from './calculations';

export interface AutoProcessResult {
  created: number;
  totalAmount: number;
  details: { name: string; count: number; amount: number }[];
  errors: string[];
}

export interface RunAutoProcessParams {
  userId: string;
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
  sb: SupabaseClient;
  addTransaction: (tx: Transaction) => void;
  updateFixedExpense: (id: string, patch: Partial<FixedExpense>) => void;
  asOf?: Date;
  // Optional gate: asked before creating a large batch for ONE expense
  // (e.g. when you add an old fixed expense that back-fills many months).
  // Return false to skip creating that expense's entries.
  confirmBatch?: (info: { name: string; count: number; amount: number }) => boolean;
  // Limit processing to a single fixed expense (used right after adding one).
  onlyId?: string;
}

function feToTxType(t: FixedExpense['type']): TransactionType {
  if (t === 'expense') return 'expense';
  if (t === 'saving' || t === 'investment') return 'saving';
  return 'transfer';
}

export async function runAutoProcess(params: RunAutoProcessParams): Promise<AutoProcessResult> {
  const { userId, fixedExpenses, transactions, sb, addTransaction, updateFixedExpense } = params;
  const asOf = params.asOf ?? new Date();
  const result: AutoProcessResult = { created: 0, totalAmount: 0, details: [], errors: [] };

  // Only active expenses flagged to auto-post (and optionally just one).
  const candidates = fixedExpenses.filter(fe =>
    fe.is_active && fe.auto_count && (!params.onlyId || fe.id === params.onlyId)
  );

  for (const fe of candidates) {
    const occ = getDueOccurrences(fe, asOf);
    if (occ.length === 0) continue;

    // Which periods for THIS expense already have a transaction?
    const existingPeriods = new Set(
      transactions
        .filter(t => t.fixed_expense_id === fe.id && t.period)
        .map(t => t.period as string)
    );

    const missing = occ.filter(o => !existingPeriods.has(o.period));
    if (missing.length === 0) continue;

    // Guard against a surprise large back-fill.
    if (params.confirmBatch && missing.length >= 4) {
      const proceed = params.confirmBatch({
        name: fe.name,
        count: missing.length,
        amount: missing.length * fe.amount,
      });
      if (!proceed) continue;
    }

    const rows = missing.map(o => ({
      user_id: userId,
      date: o.date,
      amount: fe.amount,
      description: `Auto: ${fe.name}`,
      type: feToTxType(fe.type),
      category: fe.category ?? null,
      owner_purpose: fe.owner_purpose ?? null,
      from_account_id: fe.from_account_id || null,
      to_account_id: fe.to_account_id || null,
      is_fixed_expense_auto: true,
      fixed_expense_id: fe.id,
      period: o.period,
    }));

    const { data, error } = await sb.from('transactions').insert(rows).select();
    if (error) {
      // A duplicate from the safety-net unique index is fine — just skip it.
      result.errors.push(`${fe.name}: ${error.message}`);
      continue;
    }
    (data ?? []).forEach((tx: any) => addTransaction(tx as Transaction));

    // Record the latest period we've reached on the fixed expense itself.
    const latestPeriod = occ[occ.length - 1].period;
    const { error: feErr } = await sb
      .from('fixed_expenses')
      .update({ last_processed_period: latestPeriod })
      .eq('id', fe.id);
    if (!feErr) updateFixedExpense(fe.id, { last_processed_period: latestPeriod });

    const amount = rows.length * fe.amount;
    result.created += rows.length;
    result.totalAmount += amount;
    result.details.push({ name: fe.name, count: rows.length, amount });
  }

  return result;
}
