'use client';
import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send } from 'lucide-react';

// ============================================================
// KNOWLEDGE BASE
// ============================================================

interface KBEntry {
  keywords: string[];
  title: string;
  formula?: string;
  explanation: string;
  example?: string;
}

const KNOWLEDGE_BASE: KBEntry[] = [
  {
    keywords: ['safe to spend', 'safe_to_spend', 'how much can i spend', 'how much can i use', 'spend safely'],
    title: 'Safe to Spend',
    formula: 'Spendable Balance − Bank-paid Upcoming Bills − Total CC Outstanding − Safe Spend Buffer',
    explanation:
      'Safe to Spend is the most conservative estimate of freely-available cash. It starts with your Spendable Balance (cash accounts), then deducts: upcoming fixed bills that will be paid from your bank (not your credit card), the full outstanding balance on all credit cards, and your configured safety buffer. The result can be negative — that just means your current cash is already spoken for.',
    example:
      'Spendable ₹80,000 − Upcoming bank bills ₹12,000 − CC outstanding ₹8,000 − Buffer ₹5,000 = Safe to Spend ₹55,000',
  },
  {
    keywords: ['savings rate', 'savings_rate', 'how much am i saving', 'saving percent', 'saving rate'],
    title: 'Savings Rate',
    formula: 'min(100, (Total Savings ÷ True Income) × 100)',
    explanation:
      'Savings Rate shows what percentage of your "true" income you actually set aside this month. True Income is used as the denominator (not total income) so gifts, reimbursements, and family contributions don\'t inflate it. The rate is capped at 100% to handle edge cases.',
    example:
      'Moved to savings ₹20,000, True Income ₹100,000 → (20,000 ÷ 100,000) × 100 = 20% savings rate',
  },
  {
    keywords: ['true income', 'true_income', 'what is true income', 'real income', 'include_in_true_income'],
    title: 'True Income',
    formula: 'Sum of Income entries where include_in_true_income = true',
    explanation:
      'True Income counts only the money you genuinely earned — salary, freelance payments, business income, and so on. It deliberately excludes one-off family contributions, reimbursements, and gifts, because those inflate your apparent income and make your savings rate look artificially good. Each income entry has an "Include in True Income" toggle you control.',
    example:
      'Salary ₹90,000 (included) + Freelance ₹10,000 (included) + Reimbursement ₹3,000 (excluded) = True Income ₹100,000',
  },
  {
    keywords: ['net cashflow', 'net_cashflow', 'cashflow', 'cash flow', 'what is left'],
    title: 'Net Cashflow',
    formula: 'Total Income − Total Expenses − Total Savings',
    explanation:
      'Net Cashflow is what remains after you account for all spending and money moved to savings this month. A positive number means you have unallocated money left. A negative number means you spent or saved more than you earned — typically covered by drawing down a cash account balance.',
    example:
      'Income ₹100,000 − Expenses ₹60,000 − Savings ₹20,000 = Net Cashflow ₹20,000',
  },
  {
    keywords: ['budget allowed till date', 'budget status', 'allowed till date', 'daily budget', 'budget_allowed_till_date', 'allowed today'],
    title: 'Budget: Allowed Till Date',
    formula: 'Posted Fixed Bills + (Discretionary Daily Rate × Days Elapsed)',
    explanation:
      'The budget bar compares what you have actually spent against what you were "allowed" to spend up to today. Fixed bills (like rent or SIPs) are treated as lump sums on their due date, not spread across the month. Only the discretionary portion of your budget is paced day-by-day. If your actual spend exceeds "allowed till date", the bar turns red.',
    example:
      'Budget ₹30,000, Fixed bills ₹10,000, Discretionary ₹20,000 over 30 days = ₹667/day. On day 15: Allowed = ₹10,000 + ₹10,000 = ₹20,000',
  },
  {
    keywords: ['projected month end', 'projected_month_end', 'projected', 'forecast', 'projection', 'end of month'],
    title: 'Projected Month-End',
    formula: 'Posted Fixed Bills + (Discretionary Daily Rate × Days in Month)',
    explanation:
      'The projected month-end figure extrapolates your current discretionary spending pace across the rest of the month and adds the full fixed bill total. It answers: "If I keep spending at this rate, what will my total be by the 31st?" This helps you see budget overruns before they happen.',
    example:
      'Fixed bills ₹10,000, spent ₹5,000 discretionary in 10 days (₹500/day) × 30 days = ₹15,000 → Projected ₹25,000',
  },
  {
    keywords: ['account balance', 'balance', 'how is balance calculated', 'account_balance', 'how balance works'],
    title: 'Account Balance',
    explanation:
      'Each account\'s balance is calculated by replaying every transaction from the beginning. Income credits an account. Expenses debit it. The sign convention is: positive balance = money you have. For credit cards, the balance is flipped — positive outstanding means you OWE that amount.',
    example:
      'Account starts at ₹0. Income ₹100,000 → ₹100,000. Expense ₹20,000 → ₹80,000. Transfer out ₹10,000 → ₹70,000. Final balance: ₹70,000',
  },
  {
    keywords: ['cc outstanding', 'credit card', 'outstanding', 'cc_outstanding', 'credit card balance', 'card debt'],
    title: 'Credit Card Outstanding',
    formula: 'Initial Outstanding + CC Purchases − CC Bill Payments − Transfers to Card',
    explanation:
      'The CC outstanding tracks how much you currently owe on each card. Every purchase on the card increases the outstanding. Every time you pay the card bill, or transfer money to the card, the outstanding decreases. The dashboard always shows the live outstanding — it is not just this month\'s spending.',
    example:
      'Opening balance ₹5,000 + Purchases ₹8,000 − Bill payment ₹10,000 = Outstanding ₹3,000',
  },
  {
    keywords: ['goal progress', 'goal', 'can i buy', 'progress percent', 'goal_progress', 'goals', 'how close am i'],
    title: 'Goal Progress',
    formula: 'min(100, (Available Savings ÷ Expected Cost) × 100)',
    explanation:
      'Goal progress tells you what percentage of a goal\'s target price you have already saved. Goals draw from a shared savings pool in priority order. If a goal has an "Amount Allocated" set, that fixed amount is used instead of the shared pool. Once the percentage hits 100%, the goal is ready to purchase.',
    example:
      'Goal cost ₹50,000, Available savings ₹30,000 → (30,000 ÷ 50,000) × 100 = 60% progress',
  },
  {
    keywords: ['month over month', 'mom delta', 'vs last month', 'delta', 'arrow', 'mom_delta', 'compared to last month', 'change'],
    title: 'Month-over-Month Delta',
    formula: 'Current Month Value − Previous Month Value',
    explanation:
      'The small arrows (▲ / ▼) on KPI cards show how this month compares to the same metric last month. A green upward arrow on Income means you earned more. A green downward arrow on Expenses means you spent less (an improvement). A red arrow means the opposite. The delta figure shows the exact rupee change.',
    example:
      'Last month income ₹90,000, this month ₹1,00,000 → ▲ ₹10,000 (green, improvement). Last month expenses ₹60,000, this month ₹65,000 → ▲ ₹5,000 (red, worse)',
  },
  {
    keywords: ['spendable balance', 'spendable', 'cash accounts', 'spendable_balance', 'how much cash', 'available cash'],
    title: 'Spendable Balance',
    formula: 'Sum of balances of all active cash-type accounts with "Show on Dashboard" enabled',
    explanation:
      'Spendable Balance is the total across all your current/checking/bank accounts that are marked as cash-type. It excludes savings accounts, investment accounts, family/shared accounts, and credit cards. This is your day-to-day spending pool before any deductions.',
    example:
      'HDFC Savings (cash role) ₹50,000 + ICICI Checking ₹30,000 = Spendable Balance ₹80,000',
  },
  {
    keywords: ['upcoming fixed', 'upcoming bills', 'upcoming_fixed', 'upcoming expenses', 'bills due', 'due this month'],
    title: 'Upcoming Fixed Expenses',
    explanation:
      'Upcoming Fixed shows recurring bills that are due this month but haven\'t been posted yet as transactions. It excludes: bills that have already been auto-posted this month, bills whose date hasn\'t started yet (start_date in the future), and bills that have expired (end_date passed). This is the amount you still need to set aside.',
    example:
      'Rent ₹15,000 (not yet posted) + Electricity ₹2,000 (not yet posted) = Upcoming Fixed ₹17,000',
  },
  {
    keywords: ['bank balance', 'total bank balance', 'bank_balance', 'total liquid'],
    title: 'Total Bank Balance',
    formula: 'Spendable Balance + Savings Balance',
    explanation:
      'Total Bank Balance is the sum of all your liquid personal money — cash accounts plus savings accounts. It does NOT include investment accounts (SIPs, mutual funds), family/shared accounts, or credit card outstanding. This is your net personal liquid wealth.',
    example:
      'Spendable ₹80,000 + Savings ₹1,20,000 = Total Bank Balance ₹2,00,000',
  },
  {
    keywords: ['salary bar', 'salary usage', 'salary_bar', 'salary limit', 'income bar', 'used salary'],
    title: 'Salary Usage Bar',
    formula: 'Total Expenses ÷ Total Income × 100',
    explanation:
      'The salary bar at the top of the dashboard shows what percentage of this month\'s income has been spent. If the bar is blue, you\'re within budget. If it turns red, you\'ve spent more than your total income this month. The bar only appears if you have salary income recorded for the current month.',
    example:
      'Salary ₹1,00,000, Spent ₹65,000 → 65% bar (blue). If spent ₹1,10,000 → 110% bar (red, over budget)',
  },
  {
    keywords: ['payday sweep', 'sweep', 'auto sweep', 'payday_sweep', 'leftover', 'sweep to savings'],
    title: 'Payday Sweep',
    explanation:
      'When your salary lands, the app checks if there is leftover money in your salary account from the previous month. That leftover is offered to move to savings automatically (if sweep is enabled in Settings). This prevents old salary money from inflating your "Safe to Spend" — you start each month fresh on the new salary only.',
    example:
      'Previous month leftover in salary account: ₹12,000 → auto-moved to Savings on payday. New month starts with just the new salary.',
  },
  {
    keywords: ['auto process', 'auto post', 'automatic', 'fixed_expense_auto', 'recurring auto', 'auto-process'],
    title: 'Auto-Processing Fixed Expenses',
    explanation:
      'Each time you open the dashboard, the app automatically creates real transactions for any fixed expenses that are due and haven\'t been posted yet this month. This keeps your balances and budget tracking accurate without manual entry. The process is idempotent — it will never create a duplicate if the same bill was already posted. A toast notification appears if any entries were auto-posted.',
    example:
      'SIP of ₹5,000 due on the 5th → if it\'s the 6th and no transaction exists, app auto-creates it. Next time you open the dashboard, it finds it already posted and skips it.',
  },
  {
    keywords: ['recurring income', 'recurring_income', 'auto income', 'income template'],
    title: 'Recurring Income',
    explanation:
      'Recurring Income templates work exactly like fixed expenses but for income. You set up a template with an amount, source, and due day. Each time the dashboard loads, any due recurring income entries that haven\'t been created yet are auto-processed. This is useful for consistent monthly income like rent received, stipends, or side income.',
    example:
      'Rent received template: ₹10,000 on the 1st of each month → automatically creates an income entry on the 1st if not already present.',
  },
  {
    keywords: ['family expense', 'family_expense', 'personal expense', 'shared expense', 'joint expense'],
    title: 'Family vs Personal Expense',
    explanation:
      'Every expense is classified as either "family" or "personal" based on which account it was paid from. If the source account has a type of family/shared/joint, it\'s counted as a family expense. All other expenses are personal. This lets you see how much of your spending is household/shared versus your own individual spending.',
    example:
      'Grocery paid from Joint Account (family type) → Family Expense. Dinner paid from HDFC Savings (cash type) → Personal Expense.',
  },
  {
    keywords: ['investment', 'investments', 'net worth', 'investment_accounts', 'sip', 'mutual fund'],
    title: 'Investment Accounts & Net Worth',
    explanation:
      'Investment accounts (SIPs, mutual funds, stocks, demat accounts) are excluded from both Spendable Balance and Savings Balance. They are only counted in the Net Worth figure shown below the KPI cards. Net Worth = Cash + Savings + Investments − CC Outstanding. This keeps your day-to-day spending figures clean and unaffected by long-term holdings.',
    example:
      'Cash ₹80,000 + Savings ₹1,20,000 + Investments ₹3,00,000 − CC ₹8,000 = Net Worth ₹4,92,000. Spendable is still just ₹80,000.',
  },
  {
    keywords: ['budget recovery', 'recovery', 'recovery per day', 'budget_recovery', 'overspent recovery', 'catch up'],
    title: 'Budget Recovery Per Day',
    formula: 'Overspent Amount ÷ Days Remaining in Month',
    explanation:
      'When you\'ve spent more than the "allowed till date" in a budget category, the app calculates how much you need to cut back each day for the rest of the month to get back on track. This is shown on the budget page. If there are no remaining days, it shows infinity (you\'ve already exceeded the month).',
    example:
      'Overspent by ₹3,000 with 10 days remaining → Recovery per day = ₹300. Spend ₹300 less than your normal daily rate to recover by month-end.',
  },
];

const FALLBACK: KBEntry = {
  keywords: [],
  title: 'I can help with...',
  explanation:
    'I can explain: Safe to Spend, Savings Rate, True Income, Net Cashflow, Budget status, Goal progress, Account balances, Credit card outstanding, Month-over-month deltas, Upcoming fixed expenses, Payday sweep, and more. Just ask me anything about a number you see in the app!',
};

const QUICK_CHIPS = [
  'Safe to spend?',
  'Savings rate?',
  'Budget status?',
  'Net cashflow?',
  'True income?',
];

// ============================================================
// KEYWORD MATCHING
// ============================================================

function findAnswer(query: string): KBEntry {
  const q = query.toLowerCase();
  for (const entry of KNOWLEDGE_BASE) {
    if (entry.keywords.some(kw => q.includes(kw))) {
      return entry;
    }
  }
  return FALLBACK;
}

// ============================================================
// MESSAGE TYPES
// ============================================================

interface Message {
  role: 'user' | 'bot';
  text: string;
  entry?: KBEntry;
}

// ============================================================
// BOT RESPONSE BUBBLE
// ============================================================

function BotBubble({ entry }: { entry: KBEntry }) {
  return (
    <div
      className="rounded-xl p-3 text-sm max-w-[92%]"
      style={{ background: 'var(--bg-subtle, #f1f5f9)', color: 'var(--text-primary)' }}
    >
      <p className="font-semibold mb-1">{entry.title}</p>
      {entry.formula && (
        <code className="block bg-slate-100 dark:bg-slate-800 rounded p-2 text-xs font-mono mt-1 mb-1 whitespace-pre-wrap break-words">
          {entry.formula}
        </code>
      )}
      <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>
        {entry.explanation}
      </p>
      {entry.example && (
        <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted, #94a3b8)' }}>
          e.g. {entry.example}
        </p>
      )}
    </div>
  );
}

// ============================================================
// WELCOME MESSAGE ENTRY (static)
// ============================================================

const WELCOME_ENTRY: KBEntry = {
  keywords: [],
  title: 'MCS Finance Bot',
  explanation:
    "Hi! I'm your MCS Finance Bot 🤖 I can explain any calculation or number in this app. Ask me anything!",
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export function FinanceBot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: '', entry: WELCOME_ENTRY },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry = findAnswer(trimmed);
    setMessages(prev => [
      ...prev,
      { role: 'user', text: trimmed },
      { role: 'bot', text: '', entry },
    ]);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* Floating button — bottom-left */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 left-6 z-50 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-lg flex items-center justify-center text-white transition-all duration-200"
        title="MCS Finance Bot"
        aria-label="Open Finance Bot"
      >
        {open ? <X size={20} /> : <Bot size={20} />}
      </button>

      {/* Chat panel — slides up from bottom-left */}
      {open && (
        <div
          className="fixed bottom-[5.5rem] left-6 z-50 flex flex-col rounded-2xl shadow-2xl border overflow-hidden animate-fade-in-up"
          style={{
            width: 380,
            height: 520,
            background: 'var(--bg-primary, #ffffff)',
            borderColor: 'var(--border-default, #e2e8f0)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <Bot size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>MCS Finance Bot</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>Knows your data</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              aria-label="Close Finance Bot"
            >
              <X size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((msg, i) =>
              msg.role === 'bot' ? (
                <div key={i} className="flex items-end gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                    <Bot size={12} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  {msg.entry ? (
                    <BotBubble entry={msg.entry} />
                  ) : (
                    <div
                      className="rounded-xl p-3 text-sm max-w-[92%]"
                      style={{ background: 'var(--bg-subtle, #f1f5f9)', color: 'var(--text-primary)' }}
                    >
                      {msg.text}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className="flex justify-end">
                  <div className="bg-blue-600 text-white rounded-xl p-3 text-sm max-w-[80%] leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              )
            )}

            {/* Quick chips — only show under the welcome message (when only 1 message) */}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-1.5 pl-8">
                {QUICK_CHIPS.map(chip => (
                  <button
                    key={chip}
                    onClick={() => sendMessage(chip)}
                    className="text-xs px-2.5 py-1 rounded-full border hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                    style={{
                      borderColor: 'var(--border-default, #e2e8f0)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div
            className="px-3 py-3 border-t flex items-center gap-2"
            style={{ borderColor: 'var(--border-default, #e2e8f0)' }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any number..."
              className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{
                background: 'var(--bg-subtle, #f8fafc)',
                borderColor: 'var(--border-default, #e2e8f0)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors"
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
