import { describe, it, expect } from 'vitest';
import { runAutoProcess } from './autoProcess';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixedExpense, Transaction } from '@/types';

// Minimal chainable Supabase mock: supports
//   from(t).insert(rows).select()  -> { data: rows(+ids), error: null }
//   from(t).update(patch).eq(c,v)  -> { error: null }
function makeSb() {
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const sb = {
    from(table: string) {
      return {
        insert(rows: Record<string, unknown>[]) {
          return {
            select: async () => {
              inserts.push({ table, rows });
              return { data: rows.map((r, i) => ({ ...r, id: `mock-${table}-${i}` })), error: null };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return { eq: async () => { updates.push({ table, patch }); return { error: null }; } };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, inserts, updates };
}

const fe = (o: Partial<FixedExpense>): FixedExpense => ({
  id: 'fe1', user_id: 'u', name: 'Rent', amount: 1000, type: 'expense',
  due_day: 10, start_date: '2026-01-10', is_active: true, auto_count: true,
  sort_order: 0, created_at: '', updated_at: '', ...o,
} as FixedExpense);

const ASOF = new Date(2026, 2, 15); // 15 Mar 2026 → Jan/Feb/Mar 10th are due

describe('runAutoProcess', () => {
  it('posts the missing due periods and records the latest period', async () => {
    const { sb, inserts, updates } = makeSb();
    const added: Transaction[] = [];
    const res = await runAutoProcess({
      userId: 'u', fixedExpenses: [fe({})], transactions: [], sb,
      addTransaction: t => added.push(t),
      updateFixedExpense: () => {},
      asOf: ASOF,
    });
    expect(res.created).toBe(3);                 // Jan, Feb, Mar
    expect(res.totalAmount).toBe(3000);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].rows).toHaveLength(3);
    expect(added).toHaveLength(3);
    expect(updates[0].patch.last_processed_period).toBe('2026-03');
  });

  it('is idempotent — skips periods that already have a transaction', async () => {
    const { sb, inserts } = makeSb();
    const existing: Transaction[] = ['2026-01', '2026-02', '2026-03'].map(p => ({
      id: 't-' + p, user_id: 'u', date: p + '-10', amount: 1000, type: 'expense',
      is_fixed_expense_auto: true, fixed_expense_id: 'fe1', period: p,
      created_at: '', updated_at: '',
    } as Transaction));
    const res = await runAutoProcess({
      userId: 'u', fixedExpenses: [fe({})], transactions: existing, sb,
      addTransaction: () => {}, updateFixedExpense: () => {}, asOf: ASOF,
    });
    expect(res.created).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('only processes active + auto_count expenses', async () => {
    const { sb } = makeSb();
    const res = await runAutoProcess({
      userId: 'u',
      fixedExpenses: [
        fe({ id: 'a', is_active: false }),
        fe({ id: 'b', auto_count: false }),
      ],
      transactions: [], sb, addTransaction: () => {}, updateFixedExpense: () => {}, asOf: ASOF,
    });
    expect(res.created).toBe(0);
  });

  it('honors onlyId to limit processing to one expense', async () => {
    const { sb } = makeSb();
    const res = await runAutoProcess({
      userId: 'u',
      fixedExpenses: [fe({ id: 'fe1' }), fe({ id: 'fe2', name: 'SIP' })],
      transactions: [], sb, addTransaction: () => {}, updateFixedExpense: () => {},
      asOf: ASOF, onlyId: 'fe2',
    });
    expect(res.created).toBe(3);
    expect(res.details).toHaveLength(1);
    expect(res.details[0].name).toBe('SIP');
  });

  it('skips a large back-fill when confirmBatch returns false', async () => {
    const { sb, inserts } = makeSb();
    const res = await runAutoProcess({
      userId: 'u',
      fixedExpenses: [fe({ start_date: '2025-12-10' })], // Dec,Jan,Feb,Mar = 4 → triggers gate
      transactions: [], sb, addTransaction: () => {}, updateFixedExpense: () => {},
      asOf: ASOF, confirmBatch: () => false,
    });
    expect(res.created).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});
