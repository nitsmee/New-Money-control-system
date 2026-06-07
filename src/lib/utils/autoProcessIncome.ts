// ============================================================
// AUTO-PROCESSING for recurring income
// Generates real income rows for every due date a recurring income
// template has reached — back-filling any months that were missed
// and posting each new month as its due date arrives.
//
// Idempotent: before creating an entry for a given month it checks
// whether one already exists (by recurring_income_id + period), so
// running it many times never creates duplicates.
// ============================================================
import { RecurringIncome } from '@/types';
import { getDueOccurrences } from './calculations';
import { SupabaseClient } from '@supabase/supabase-js';

export interface AutoProcessIncomeResult {
  processed: number;
  skipped: number;
  errors: string[];
}

export async function runAutoProcessIncome(
  sb: SupabaseClient,
  recurringIncome: RecurringIncome[],
  userId: string,
  asOf: Date = new Date()
): Promise<AutoProcessIncomeResult> {
  const result: AutoProcessIncomeResult = { processed: 0, skipped: 0, errors: [] };
  const activeItems = recurringIncome.filter(ri => ri.is_active);
  if (activeItems.length === 0) return result;

  for (const ri of activeItems) {
    try {
      // Income rows require a destination account (NOT NULL). Skip templates
      // that have none so the batch insert can't fail on the whole run.
      if (!ri.to_account_id) {
        result.errors.push(`${ri.name}: no destination account set — skipped`);
        continue;
      }
      // Get all due occurrences up to today
      const occurrences = getDueOccurrences(
        { due_day: ri.due_day, start_date: ri.start_date, end_date: ri.end_date ?? undefined },
        asOf
      );
      if (occurrences.length === 0) { result.skipped++; continue; }

      // Check which periods already have income rows for this recurring_income_id
      const { data: existing } = await sb
        .from('income')
        .select('period')
        .eq('recurring_income_id', ri.id)
        .eq('user_id', userId);
      const processedPeriods = new Set((existing ?? []).map((r: { period: string }) => r.period));

      const toProcess = occurrences.filter(o => !processedPeriods.has(o.period));
      if (toProcess.length === 0) { result.skipped++; continue; }

      // Build income rows
      const rows = toProcess.map(o => ({
        user_id: userId,
        date: o.date,
        period: o.period,
        amount: ri.amount,
        category: ri.category,
        owner_purpose: ri.owner_purpose ?? 'Personal',
        to_account_id: ri.to_account_id,
        include_in_true_income: ri.include_in_true_income,
        description: ri.name,
        source: ri.category,
        recurring_income_id: ri.id,
      }));

      const { error } = await sb.from('income').insert(rows);
      if (error) {
        result.errors.push(`${ri.name}: ${error.message}`);
        continue;
      }

      // Update last_processed_period
      const lastPeriod = toProcess[toProcess.length - 1].period;
      await sb.from('recurring_income')
        .update({ last_processed_period: lastPeriod, updated_at: new Date().toISOString() })
        .eq('id', ri.id);

      result.processed += toProcess.length;
    } catch (e: unknown) {
      result.errors.push(`${ri.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
