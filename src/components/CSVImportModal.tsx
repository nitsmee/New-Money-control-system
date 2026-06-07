'use client';
import { useState, useRef, useCallback } from 'react';
import { X, Upload, CheckCircle } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/appStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: (count: number) => void;
}

type Step = 'upload' | 'map' | 'preview' | 'importing';

interface ColumnMap {
  date: string;
  amount: string;
  description: string;
  category: string;
}

type DateFormat = 'auto' | 'dmy' | 'mdy' | 'ymd';

function parseDate(val: string, fmt: DateFormat): string | null {
  const v = val.trim();
  if (!v) return null;
  // Helper: build & validate a YYYY-MM-DD from local parts (no UTC shift).
  const build = (year: number, month: number, day: number): string | null => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return ymd;
  };
  // YYYY-MM-DD (explicit or matched): validate it's a real date.
  if (fmt === 'ymd' || /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));
    return null;
  }
  // Slash/dash dates with three numeric parts and a 4-digit year last.
  const parts = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    const year = Number(parts[3]);
    let day: number;
    let month: number;
    if (fmt === 'dmy') {
      day = a; month = b;
    } else if (fmt === 'mdy') {
      month = a; day = b;
    } else {
      // auto: a>12 must be day (dmy); b>12 must be mdy; else default dmy (Indian app default).
      if (a > 12) { day = a; month = b; }
      else if (b > 12) { month = a; day = b; }
      else { day = a; month = b; }
    }
    return build(year, month, day);
  }
  // Fallback: parse with Date but extract local parts to avoid UTC offset.
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

interface MappedRow {
  date: string;
  amount: number;
  signed: number;
  description: string;
  category: string;
}

export function CSVImportModal({ isOpen, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [colMap, setColMap] = useState<ColumnMap>({ date: '', amount: '', description: '', category: '' });
  const [accountId, setAccountId] = useState('');
  const [txType, setTxType] = useState<'expense' | 'income'>('expense');
  const [dateFormat, setDateFormat] = useState<'auto' | 'dmy' | 'mdy' | 'ymd'>('auto');
  const [signedAmounts, setSignedAmounts] = useState(false);
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { accounts } = useAppStore();
  const activeAccounts = accounts.filter(a => a.is_active);

  function handleFile(file: File) {
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const data = result.data as Record<string, string>[];
        setRows(data);
        const cols = result.meta.fields ?? [];
        setColumns(cols);
        // Auto-detect common column names
        const dateCol = cols.find(c => /date/i.test(c)) ?? '';
        const amtCol = cols.find(c => /amount|amt|value|debit|credit/i.test(c)) ?? '';
        const descCol = cols.find(c => /desc|narr|particular|note|detail/i.test(c)) ?? '';
        const catCol = cols.find(c => /categ|type|tag/i.test(c)) ?? '';
        setColMap({ date: dateCol, amount: amtCol, description: descCol, category: catCol });
        setStep('map');
      },
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) handleFile(file);
    else toast.error('Please drop a CSV file');
  }

  function buildMapped() {
    const mapped: MappedRow[] = [];
    for (const row of rows) {
      const dateStr = parseDate(row[colMap.date] ?? '', dateFormat);
      const amt = parseFloat(row[colMap.amount] ?? '0');
      if (!dateStr || isNaN(amt)) continue;
      mapped.push({
        date: dateStr,
        amount: Math.abs(amt),
        signed: amt,
        description: row[colMap.description] ?? '',
        category: colMap.category ? (row[colMap.category] ?? '') : '',
      });
    }
    return mapped;
  }

  function handleGoPreview() {
    if (!colMap.date || !colMap.amount) {
      toast.error('Please map Date and Amount columns');
      return;
    }
    if (!accountId) {
      toast.error('Please select a default account');
      return;
    }
    const mapped = buildMapped();
    if (mapped.length === 0) {
      toast.error('No valid rows found after mapping');
      return;
    }
    setMappedRows(mapped);
    setStep('preview');
  }

  const handleImport = useCallback(async () => {
    setStep('importing');
    setProgress(0);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not authenticated'); setStep('preview'); return; }

    // Dedup: check existing transactions for expense imports
    const existingTransactions = useAppStore.getState().transactions;

    let imported = 0;
    let skipped = 0;
    const batchSize = 50;

    // Helpers to build insert payloads (shared by signed & unsigned paths).
    const toExpenseRow = (r: MappedRow) => ({
      date: r.date,
      amount: r.amount,
      description: r.description,
      type: 'expense' as const,
      from_account_id: accountId,
      category: r.category || 'Import',
      period: r.date.slice(0, 7),
      user_id: user.id,
    });
    const toIncomeRow = (r: MappedRow) => ({
      date: r.date,
      amount: r.amount,
      description: r.description,
      to_account_id: accountId,
      category: r.category || 'Import',
      owner_purpose: 'Personal',
      include_in_true_income: true,
      user_id: user.id,
    });

    // Determine, per row, whether it is an expense (true) or income (false).
    // When signedAmounts is on, sign decides; otherwise the single txType selector decides.
    const expenseRows: MappedRow[] = [];
    const incomeRows: MappedRow[] = [];
    for (const r of mappedRows) {
      let asExpense: boolean;
      if (signedAmounts) {
        if (r.signed === 0) continue; // skip zero-amount rows
        asExpense = r.signed < 0;
      } else {
        asExpense = txType === 'expense';
      }
      if (asExpense) {
        // Dedup expenses against existing transactions (date + amount + description).
        const isDup = existingTransactions.some(t =>
          t.date === r.date && t.amount === r.amount && (t.description ?? '') === (r.description ?? '')
        );
        if (isDup) { skipped++; continue; }
        expenseRows.push(r);
      } else {
        incomeRows.push(r);
      }
    }

    const total = expenseRows.length + incomeRows.length;
    let processed = 0;

    for (let i = 0; i < expenseRows.length; i += batchSize) {
      const batch = expenseRows.slice(i, i + batchSize);
      const { error } = await supabase.from('transactions').insert(batch.map(toExpenseRow));
      if (!error) imported += batch.length;
      processed += batch.length;
      setProgress(total > 0 ? Math.round((processed / total) * 100) : 100);
    }

    for (let i = 0; i < incomeRows.length; i += batchSize) {
      const batch = incomeRows.slice(i, i + batchSize);
      const { error } = await supabase.from('income').insert(batch.map(toIncomeRow));
      if (!error) imported += batch.length;
      processed += batch.length;
      setProgress(total > 0 ? Math.round((processed / total) * 100) : 100);
    }

    // Refresh the store so imported rows appear immediately (no manual reload).
    if (imported > 0) {
      try { await useAppStore.getState().loadAll(user.id); } catch { /* non-fatal */ }
    }

    const skipMsg = skipped > 0 ? ` (${skipped} duplicate${skipped > 1 ? 's' : ''} skipped)` : '';
    toast.success(`Imported ${imported} transactions${skipMsg}`);
    onImported(imported);
    onClose();
    setStep('upload');
    setRows([]);
    setFileName('');
  }, [mappedRows, txType, accountId, signedAmounts, onImported, onClose]);

  function handleClose() {
    onClose();
    setStep('upload');
    setRows([]);
    setFileName('');
    setMappedRows([]);
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={handleClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between card-p border-b" style={{ borderColor: 'var(--border-default)' }}>
          <div>
            <h2 className="font-semibold text-base">Import CSV</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {step === 'upload' && 'Step 1 of 4 — Upload'}
              {step === 'map' && 'Step 2 of 4 — Map Columns'}
              {step === 'preview' && 'Step 3 of 4 — Preview'}
              {step === 'importing' && 'Step 4 of 4 — Importing'}
            </p>
          </div>
          <button onClick={handleClose} className="btn-icon"><X size={16} /></button>
        </div>

        <div className="card-p space-y-4">
          {/* STEP 1: Upload */}
          {step === 'upload' && (
            <div
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${isDragging ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''}`}
              style={{ borderColor: isDragging ? undefined : 'var(--border-default)' }}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={32} style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-medium">Drag & drop a CSV file here</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>or click to browse</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
              />
            </div>
          )}

          {/* STEP 2: Map Columns */}
          {step === 'map' && (
            <div className="space-y-4">
              <p className="text-sm font-medium">File: <span style={{ color: 'var(--text-secondary)' }}>{fileName}</span> · {rows.length} rows</p>

              {/* Column mappings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['date', 'amount', 'description', 'category'] as const).map(field => (
                  <div key={field} className="form-group">
                    <label className="form-label capitalize">{field} column {field !== 'description' && field !== 'category' && <span className="text-red-400">*</span>}</label>
                    <select
                      className="form-select"
                      value={colMap[field]}
                      onChange={e => setColMap(prev => ({ ...prev, [field]: e.target.value }))}
                    >
                      <option value="">-- None --</option>
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {/* Account + type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Default Account <span className="text-red-400">*</span></label>
                  <select className="form-select" value={accountId} onChange={e => setAccountId(e.target.value)}>
                    <option value="">Select account…</option>
                    {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Transaction Type</label>
                  <select
                    className="form-select"
                    value={txType}
                    onChange={e => setTxType(e.target.value as 'expense' | 'income')}
                    disabled={signedAmounts}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Date format</label>
                  <select
                    className="form-select"
                    value={dateFormat}
                    onChange={e => setDateFormat(e.target.value as 'auto' | 'dmy' | 'mdy' | 'ymd')}
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="dmy">DD/MM/YYYY</option>
                    <option value="mdy">MM/DD/YYYY</option>
                    <option value="ymd">YYYY-MM-DD</option>
                  </select>
                </div>
              </div>

              {/* Signed amounts */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={signedAmounts}
                  onChange={e => setSignedAmounts(e.target.checked)}
                />
                <span>Amounts are signed (negative = money out, positive = money in)</span>
              </label>

              {/* Preview rows */}
              {colMap.date && colMap.amount && (
                <div className="overflow-x-auto">
                  <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>First 3 rows preview:</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                        <th className="text-left py-1 px-2">Date</th>
                        <th className="text-left py-1 px-2">Amount</th>
                        <th className="text-left py-1 px-2">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 3).map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-default)' }}>
                          <td className="py-1 px-2">{row[colMap.date] ?? '—'}</td>
                          <td className="py-1 px-2">{row[colMap.amount] ?? '—'}</td>
                          <td className="py-1 px-2">{colMap.description ? row[colMap.description] : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep('upload')} className="btn-md btn-secondary">Back</button>
                <button onClick={handleGoPreview} className="btn-md btn-primary">Next: Preview</button>
              </div>
            </div>
          )}

          {/* STEP 3: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <p className="text-sm">
                <span className="font-semibold">{mappedRows.length}</span> rows ready to import as{' '}
                <span className="font-semibold capitalize">{txType}</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                      <th className="text-left py-1 px-2">#</th>
                      <th className="text-left py-1 px-2">Date</th>
                      <th className="text-left py-1 px-2">Description</th>
                      <th className="text-right py-1 px-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 10).map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-default)' }}>
                        <td className="py-1 px-2 text-muted">{i + 1}</td>
                        <td className="py-1 px-2">{r.date}</td>
                        <td className="py-1 px-2">{r.description || '—'}</td>
                        <td className="py-1 px-2 text-right font-medium">₹{r.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {mappedRows.length > 10 && (
                  <p className="text-xs text-center pt-2" style={{ color: 'var(--text-muted)' }}>
                    …and {mappedRows.length - 10} more rows
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep('map')} className="btn-md btn-secondary">Back</button>
                <button onClick={handleImport} className="btn-md btn-primary">
                  Import {mappedRows.length} transactions
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center gap-4 py-8">
              {progress < 100 ? (
                <>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Importing… {Math.min(progress, 100)}%</p>
                </>
              ) : (
                <>
                  <CheckCircle size={40} className="text-green-500" />
                  <p className="text-sm font-medium">Import complete!</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
