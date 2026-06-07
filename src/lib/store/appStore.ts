import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Account, Category, Owner, Income, Transaction,
  FixedExpense, Budget, Goal, UserSettings, DateFilter, RecurringIncome
} from '@/types';
import { createClient } from '@/lib/supabase/client';

interface AppState {
  // Master data
  accounts: Account[];
  categories: Category[];
  owners: Owner[];

  // Transactions
  income: Income[];
  transactions: Transaction[];
  fixedExpenses: FixedExpense[];
  budgets: Budget[];
  goals: Goal[];

  // Settings & UI
  settings: UserSettings | null;
  dateFilter: DateFilter;
  isLoading: boolean;
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';

  // Actions
  setDateFilter: (f: DateFilter) => void;
  setSidebarOpen: (v: boolean) => void;
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  loadAll: (userId: string) => Promise<void>;
  refreshData: (userId: string) => Promise<void>;

  // CRUD helpers
  addIncome: (income: Income) => void;
  updateIncome: (id: string, income: Partial<Income>) => void;
  removeIncome: (id: string) => void;

  addTransaction: (tx: Transaction) => void;
  updateTransaction: (id: string, tx: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;

  addFixedExpense: (fe: FixedExpense) => void;
  updateFixedExpense: (id: string, fe: Partial<FixedExpense>) => void;
  removeFixedExpense: (id: string) => void;

  addBudget: (b: Budget) => void;
  updateBudget: (id: string, b: Partial<Budget>) => void;
  removeBudget: (id: string) => void;

  addGoal: (g: Goal) => void;
  updateGoal: (id: string, g: Partial<Goal>) => void;
  removeGoal: (id: string) => void;

  recurringIncome: RecurringIncome[];
  setRecurringIncome: (items: RecurringIncome[]) => void;
  addRecurringIncome: (item: RecurringIncome) => void;
  updateRecurringIncome: (id: string, item: Partial<RecurringIncome>) => void;
  removeRecurringIncome: (id: string) => void;

  addAccount: (a: Account) => void;
  updateAccount: (id: string, a: Partial<Account>) => void;
  removeAccount: (id: string) => void;

  addCategory: (c: Category) => void;
  updateCategory: (id: string, c: Partial<Category>) => void;
  removeCategory: (id: string) => void;

  addOwner: (o: Owner) => void;
  updateOwner: (id: string, o: Partial<Owner>) => void;
  removeOwner: (id: string) => void;

  updateSettings: (s: Partial<UserSettings>) => void;
}

const now = new Date();

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      accounts: [],
      categories: [],
      owners: [],
      income: [],
      transactions: [],
      fixedExpenses: [],
      budgets: [],
      goals: [],
      recurringIncome: [],
      settings: null,
      dateFilter: {
        view: 'monthly',
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        status_date: now.toISOString().split('T')[0],
      },
      isLoading: false,
      sidebarOpen: true,
      theme: 'light',

      setDateFilter: (f) => set({ dateFilter: f }),
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      setTheme: (t) => set({ theme: t }),

      loadAll: async (userId: string) => {
        set({ isLoading: true });
        const sb = createClient();

        try {
          const [
            { data: accounts },
            { data: categories },
            { data: owners },
            { data: income },
            { data: transactions },
            { data: fixedExpenses },
            { data: budgets },
            { data: goals },
            { data: settings },
            { data: recurringIncomeData },
          ] = await Promise.all([
            sb.from('accounts').select('*').eq('user_id', userId).order('sort_order'),
            sb.from('categories').select('*').eq('user_id', userId).order('sort_order'),
            sb.from('owners').select('*').eq('user_id', userId).order('sort_order'),
            sb.from('income').select('*').eq('user_id', userId).order('date', { ascending: false }),
            sb.from('transactions').select('*').eq('user_id', userId).order('date', { ascending: false }),
            sb.from('fixed_expenses').select('*').eq('user_id', userId).order('sort_order'),
            sb.from('budget').select('*').eq('user_id', userId),
            sb.from('goals').select('*').eq('user_id', userId).order('priority'),
            sb.from('user_settings').select('*').eq('user_id', userId).single(),
            sb.from('recurring_income').select('*').eq('user_id', userId).order('created_at'),
          ]);

          set({
            accounts: accounts ?? [],
            categories: categories ?? [],
            owners: owners ?? [],
            income: income ?? [],
            transactions: transactions ?? [],
            fixedExpenses: fixedExpenses ?? [],
            budgets: budgets ?? [],
            goals: goals ?? [],
            settings: settings ?? null,
            recurringIncome: recurringIncomeData ?? [],
          });
        } catch (e) {
          // A failed fetch must never leave the app stuck on the loading
          // skeleton — surface nothing, just stop loading.
          console.error('loadAll failed:', e);
        } finally {
          set({ isLoading: false });
        }
      },

      refreshData: async (userId: string) => {
        await get().loadAll(userId);
      },

      // Income CRUD
      addIncome: (inc) => set(s => ({ income: [inc, ...s.income] })),
      updateIncome: (id, data) => set(s => ({ income: s.income.map(i => i.id === id ? { ...i, ...data } : i) })),
      removeIncome: (id) => set(s => ({ income: s.income.filter(i => i.id !== id) })),

      // Transaction CRUD
      addTransaction: (tx) => set(s => ({ transactions: [tx, ...s.transactions] })),
      updateTransaction: (id, data) => set(s => ({ transactions: s.transactions.map(t => t.id === id ? { ...t, ...data } : t) })),
      removeTransaction: (id) => set(s => ({ transactions: s.transactions.filter(t => t.id !== id) })),

      // Fixed expense CRUD
      addFixedExpense: (fe) => set(s => ({ fixedExpenses: [fe, ...s.fixedExpenses] })),
      updateFixedExpense: (id, data) => set(s => ({ fixedExpenses: s.fixedExpenses.map(f => f.id === id ? { ...f, ...data } : f) })),
      removeFixedExpense: (id) => set(s => ({ fixedExpenses: s.fixedExpenses.filter(f => f.id !== id) })),

      // Budget CRUD
      addBudget: (b) => set(s => ({ budgets: [b, ...s.budgets] })),
      updateBudget: (id, data) => set(s => ({ budgets: s.budgets.map(b => b.id === id ? { ...b, ...data } : b) })),
      removeBudget: (id) => set(s => ({ budgets: s.budgets.filter(b => b.id !== id) })),

      // Goal CRUD
      addGoal: (g) => set(s => ({ goals: [g, ...s.goals] })),
      updateGoal: (id, data) => set(s => ({ goals: s.goals.map(g => g.id === id ? { ...g, ...data } : g) })),
      removeGoal: (id) => set(s => ({ goals: s.goals.filter(g => g.id !== id) })),

      // Recurring income CRUD
      setRecurringIncome: (items) => set({ recurringIncome: items }),
      addRecurringIncome: (item) => set(s => ({ recurringIncome: [...s.recurringIncome, item] })),
      updateRecurringIncome: (id, item) => set(s => ({ recurringIncome: s.recurringIncome.map(r => r.id === id ? { ...r, ...item } : r) })),
      removeRecurringIncome: (id) => set(s => ({ recurringIncome: s.recurringIncome.filter(r => r.id !== id) })),

      // Account CRUD
      addAccount: (a) => set(s => ({ accounts: [...s.accounts, a] })),
      updateAccount: (id, data) => set(s => ({ accounts: s.accounts.map(a => a.id === id ? { ...a, ...data } : a) })),
      removeAccount: (id) => set(s => ({ accounts: s.accounts.filter(a => a.id !== id) })),

      // Category CRUD
      addCategory: (c) => set(s => ({ categories: [...s.categories, c] })),
      updateCategory: (id, data) => set(s => ({ categories: s.categories.map(c => c.id === id ? { ...c, ...data } : c) })),
      removeCategory: (id) => set(s => ({ categories: s.categories.filter(c => c.id !== id) })),

      // Owner CRUD
      addOwner: (o) => set(s => ({ owners: [...s.owners, o] })),
      updateOwner: (id, data) => set(s => ({ owners: s.owners.map(o => o.id === id ? { ...o, ...data } : o) })),
      removeOwner: (id) => set(s => ({ owners: s.owners.filter(o => o.id !== id) })),

      updateSettings: (s) => set(prev => ({ settings: prev.settings ? { ...prev.settings, ...s } : null })),
    }),
    {
      name: 'mcs-store',
      partialize: (s) => ({ theme: s.theme, sidebarOpen: s.sidebarOpen, dateFilter: s.dateFilter }),
    }
  )
);
