'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Account, Category, Owner, UserSettings } from '@/types';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, Settings, Database, User, Tag, Wallet, Download, Upload } from 'lucide-react';
import Papa from 'papaparse';

type Tab = 'accounts'|'categories'|'owners'|'preferences';

export default function SettingsPage() {
  const { accounts, categories, owners, settings, addAccount, updateAccount, removeAccount, addCategory, updateCategory, removeCategory, addOwner, updateOwner, removeOwner, updateSettings, transactions, income, budgets, goals, fixedExpenses, recurringIncome } = useAppStore();
  const [tab, setTab] = useState<Tab>('accounts');
  const sb = createClient();
  const sym = settings?.currency_symbol ?? '₹';

  // ---- ACCOUNTS ----
  const [showAccForm, setShowAccForm] = useState(false);
  const [editingAcc, setEditingAcc] = useState<Account|null>(null);
  const [accForm, setAccForm] = useState({ name:'', account_type:'Bank Account', owner_purpose:'', is_active:true, include_in_dashboard:true, include_in_goal_savings:false, is_credit_card:false, is_spendable:true, notes:'' });

  const openNewAcc = () => { setEditingAcc(null); setAccForm({ name:'', account_type:'Bank Account', owner_purpose:'', is_active:true, include_in_dashboard:true, include_in_goal_savings:false, is_credit_card:false, is_spendable:true, notes:'' }); setShowAccForm(true); };
  const openEditAcc = (a: Account) => { setEditingAcc(a); setAccForm({ name:a.name, account_type:a.account_type, owner_purpose:a.owner_purpose??'', is_active:a.is_active, include_in_dashboard:a.include_in_dashboard, include_in_goal_savings:a.include_in_goal_savings, is_credit_card:a.is_credit_card, is_spendable:a.is_spendable, notes:a.notes??'' }); setShowAccForm(true); };

  const hasTransactions = (accId: string) =>
    transactions.some(t => t.from_account_id===accId || t.to_account_id===accId) ||
    income.some(i => i.to_account_id===accId);

  const saveAcc = async () => {
    if (!accForm.name) { toast.error('Account name is required'); return; }
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const payload = { ...accForm, user_id:user.id };
      if (editingAcc) {
        const { data, error } = await sb.from('accounts').update(payload).eq('id',editingAcc.id).select().single();
        if (error) throw error;
        updateAccount(editingAcc.id, data);
        toast.success('Account updated');
      } else {
        const { data, error } = await sb.from('accounts').insert(payload).select().single();
        if (error) throw error;
        addAccount(data);
        toast.success('Account added');
      }
      setShowAccForm(false);
    } catch (e:any) { toast.error(e.message); }
  };

  const deleteAcc = async (a: Account) => {
    if (hasTransactions(a.id)) {
      if (!confirm(`"${a.name}" has transactions. It will be deactivated (not deleted) to preserve history.`)) return;
      const { error } = await sb.from('accounts').update({ is_active:false }).eq('id',a.id);
      if (!error) { updateAccount(a.id, { is_active:false }); toast.success(`"${a.name}" deactivated`); }
      return;
    }
    if (!confirm(`Delete account "${a.name}"?`)) return;
    const { error } = await sb.from('accounts').delete().eq('id',a.id);
    if (!error) { removeAccount(a.id); toast.success('Account deleted'); }
    else toast.error(error.message);
  };

  // ---- CATEGORIES ----
  const [showCatForm, setShowCatForm] = useState(false);
  const [editingCat, setEditingCat] = useState<Category|null>(null);
  const [catForm, setCatForm] = useState({ name:'', type:'expense' as Category['type'], include_in_budget:true, color:'#3b82f6', is_active:true, default_account_id:'' });

  const openNewCat = () => { setEditingCat(null); setCatForm({ name:'', type:'expense', include_in_budget:true, color:'#3b82f6', is_active:true, default_account_id:'' }); setShowCatForm(true); };
  const openEditCat = (c: Category) => { setEditingCat(c); setCatForm({ name:c.name, type:c.type, include_in_budget:c.include_in_budget, color:c.color, is_active:c.is_active, default_account_id:c.default_account_id ?? '' }); setShowCatForm(true); };

  const hasCatTransactions = (name: string) => transactions.some(t => t.category===name) || income.some(i => i.category===name);

  const saveCat = async () => {
    if (!catForm.name) { toast.error('Category name is required'); return; }
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const payload = { ...catForm, user_id:user.id, icon:'tag', default_account_id: catForm.default_account_id || null };
      if (editingCat) {
        const { data, error } = await sb.from('categories').update(payload).eq('id',editingCat.id).select().single();
        if (error) throw error;
        updateCategory(editingCat.id, data);
        toast.success('Category updated');
      } else {
        const { data, error } = await sb.from('categories').insert(payload).select().single();
        if (error) throw error;
        addCategory(data);
        toast.success('Category added');
      }
      setShowCatForm(false);
    } catch (e:any) { toast.error(e.message); }
  };

  const deleteCat = async (c: Category) => {
    if (hasCatTransactions(c.name)) {
      if (!confirm(`"${c.name}" has transactions. It will be deactivated to preserve history.`)) return;
      const { error } = await sb.from('categories').update({ is_active:false }).eq('id',c.id);
      if (!error) { updateCategory(c.id, { is_active:false }); toast.success(`"${c.name}" deactivated`); }
      return;
    }
    if (!confirm(`Delete category "${c.name}"?`)) return;
    const { error } = await sb.from('categories').delete().eq('id',c.id);
    if (!error) { removeCategory(c.id); toast.success('Category deleted'); }
    else toast.error(error.message);
  };

  // ---- OWNERS ----
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [editingOwner, setEditingOwner] = useState<Owner|null>(null);
  const [ownerForm, setOwnerForm] = useState({ name:'', description:'', color:'#6366f1', is_active:true });

  const openNewOwner = () => { setEditingOwner(null); setOwnerForm({ name:'', description:'', color:'#6366f1', is_active:true }); setShowOwnerForm(true); };
  const openEditOwner = (o: Owner) => { setEditingOwner(o); setOwnerForm({ name:o.name, description:o.description??'', color:o.color, is_active:o.is_active }); setShowOwnerForm(true); };

  const saveOwner = async () => {
    if (!ownerForm.name) { toast.error('Name is required'); return; }
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const payload = { ...ownerForm, user_id:user.id };
      if (editingOwner) {
        const { data, error } = await sb.from('owners').update(payload).eq('id',editingOwner.id).select().single();
        if (error) throw error;
        updateOwner(editingOwner.id, data);
        toast.success('Owner updated');
      } else {
        const { data, error } = await sb.from('owners').insert(payload).select().single();
        if (error) throw error;
        addOwner(data);
        toast.success('Owner added');
      }
      setShowOwnerForm(false);
    } catch (e:any) { toast.error(e.message); }
  };

  // ---- PREFERENCES ----
  const [prefForm, setPrefForm] = useState({ theme: settings?.theme??'light', font_choice: settings?.font_choice??'dm-sans', currency: settings?.currency??'INR', currency_symbol: settings?.currency_symbol??'₹', safe_spend_buffer: settings?.safe_spend_buffer??5000, sweep_enabled: settings?.sweep_enabled ?? true });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExportData = async () => {
    setExporting(true);
    try {
      const exportData = {
        exported_at: new Date().toISOString(),
        version: '1.0',
        data: { accounts, transactions, income, budgets, goals, fixedExpenses, categories, owners, recurringIncome }
      };
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `money-control-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data exported successfully');
    } catch (e: any) {
      toast.error('Export failed: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  const savePrefs = async () => {
    setSavingPrefs(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data, error } = await sb.from('user_settings').update(prefForm).eq('user_id',user.id).select().single();
      if (error) throw error;
      updateSettings(data);
      document.documentElement.setAttribute('data-font', prefForm.font_choice);
      if (prefForm.theme==='dark') document.documentElement.classList.add('dark');
      else if (prefForm.theme==='light') document.documentElement.classList.remove('dark');
      toast.success('Preferences saved');
    } catch (e:any) { toast.error(e.message); } finally { setSavingPrefs(false); }
  };

  // ---- EXPORT / IMPORT ----
  const exportAllData = () => {
    const data = { accounts, categories, owners, income, transactions };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='mcs-backup.json'; a.click();
    toast.success('Data exported as JSON');
  };

  const TABS = [
    { id:'accounts', label:'Accounts', icon:Wallet },
    { id:'categories', label:'Categories', icon:Tag },
    { id:'owners', label:'Owners', icon:User },
    { id:'preferences', label:'Preferences', icon:Settings },
  ] as const;

  const ACC_TYPES = ['Bank Account','Cash Wallet','Credit Card','Savings Bucket','Family / Shared Account','External Holding','Investment / Long-Term Account'];

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Master Settings</h1>
          <p className="text-sm" style={{ color:'var(--text-secondary)' }}>Manage accounts, categories, owners, and app preferences</p>
        </div>
        <button onClick={exportAllData} className="btn-md btn-secondary"><Download size={16}/> Export Backup</button>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map(({ id, label, icon:Icon }) => (
          <button key={id} onClick={() => setTab(id as Tab)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${tab===id?'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400':'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
            <Icon size={14}/> {label}
          </button>
        ))}
      </div>

      {/* ACCOUNTS TAB */}
      {tab==='accounts' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm" style={{ color:'var(--text-secondary)' }}>{accounts.length} accounts · {accounts.filter(a => a.is_active).length} active</p>
            <button onClick={openNewAcc} className="btn-md btn-primary"><Plus size={16}/> Add Account</button>
          </div>
          <div className="card">
            <div className="table-container border-0">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Type</th><th>Dashboard</th><th>Goal Savings</th><th>CC</th><th>Spendable</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.id}>
                      <td className="font-medium text-sm">{a.name}</td>
                      <td className="text-xs">{a.account_type}</td>
                      <td>{a.include_in_dashboard?<span className="badge badge-green text-[10px]">Yes</span>:<span className="badge badge-gray text-[10px]">No</span>}</td>
                      <td>{a.include_in_goal_savings?<span className="badge badge-blue text-[10px]">Yes</span>:<span className="badge badge-gray text-[10px]">No</span>}</td>
                      <td>{a.is_credit_card?<span className="badge badge-red text-[10px]">Yes</span>:<span className="badge badge-gray text-[10px]">No</span>}</td>
                      <td>{a.is_spendable?<span className="badge badge-green text-[10px]">Yes</span>:<span className="badge badge-gray text-[10px]">No</span>}</td>
                      <td>{a.is_active?<span className="badge badge-green text-[10px]">Active</span>:<span className="badge badge-gray text-[10px]">Inactive</span>}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEditAcc(a)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13}/></button>
                          <button onClick={() => deleteAcc(a)} className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={13}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {showAccForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'var(--bg-overlay)' }}>
              <div className="card w-full max-w-md animate-fade-in-up">
                <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
                  <h2 className="text-lg font-semibold">{editingAcc?'Edit Account':'Add Account'}</h2>
                  <button onClick={() => setShowAccForm(false)} className="btn-icon"><X size={18}/></button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="form-group">
                    <label className="form-label">Account Name *</label>
                    <input type="text" className="form-input" placeholder="e.g. Main Bank Account" value={accForm.name} onChange={e => setAccForm({...accForm, name:e.target.value})}/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Account Type *</label>
                    <select className="form-select" value={accForm.account_type} onChange={e => setAccForm({...accForm, account_type:e.target.value, is_credit_card:e.target.value==='Credit Card', is_spendable:e.target.value!=='Investment / Long-Term Account'&&e.target.value!=='Savings Bucket' })}>
                      {ACC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { key:'include_in_dashboard', label:'Show on Dashboard' },
                      { key:'include_in_goal_savings', label:'Include in Goal Savings' },
                      { key:'is_credit_card', label:'Is Credit Card' },
                      { key:'is_spendable', label:'Is Spendable' },
                      { key:'is_active', label:'Active' },
                    ].map(f => (
                      <label key={f.key} className="flex items-center gap-2 cursor-pointer text-sm col-span-1">
                        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={(accForm as any)[f.key]} onChange={e => setAccForm({...accForm, [f.key]:e.target.checked})}/>
                        {f.label}
                      </label>
                    ))}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Notes</label>
                    <textarea className="form-textarea" rows={2} placeholder="Optional" value={accForm.notes} onChange={e => setAccForm({...accForm, notes:e.target.value})}/>
                  </div>
                </div>
                <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
                  <button onClick={() => setShowAccForm(false)} className="btn-md btn-secondary">Cancel</button>
                  <button onClick={saveAcc} className="btn-md btn-primary"><Check size={16}/> {editingAcc?'Update':'Add'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CATEGORIES TAB */}
      {tab==='categories' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm" style={{ color:'var(--text-secondary)' }}>{categories.length} categories · {categories.filter(c => c.is_active).length} active</p>
            <button onClick={openNewCat} className="btn-md btn-primary"><Plus size={16}/> Add Category</button>
          </div>
          <div className="card">
            <div className="table-container border-0">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Type</th><th>In Budget</th><th>Color</th><th>Routes to</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.id}>
                      <td className="font-medium text-sm">{c.name}</td>
                      <td><span className="badge badge-blue text-[10px]">{c.type}</span></td>
                      <td>{c.include_in_budget?<span className="badge badge-green text-[10px]">Yes</span>:<span className="badge badge-gray text-[10px]">No</span>}</td>
                      <td><span className="flex items-center gap-1.5 text-xs"><span className="w-3.5 h-3.5 rounded-full border border-slate-200" style={{ background:c.color }}/>{c.color}</span></td>
                      <td className="text-xs">{accounts.find(a => a.id === c.default_account_id)?.name ?? '—'}</td>
                      <td>{c.is_active?<span className="badge badge-green text-[10px]">Active</span>:<span className="badge badge-gray text-[10px]">Inactive</span>}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEditCat(c)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13}/></button>
                          <button onClick={() => deleteCat(c)} className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={13}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {showCatForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'var(--bg-overlay)' }}>
              <div className="card w-full max-w-md animate-fade-in-up">
                <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
                  <h2 className="text-lg font-semibold">{editingCat?'Edit Category':'Add Category'}</h2>
                  <button onClick={() => setShowCatForm(false)} className="btn-icon"><X size={18}/></button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="form-group"><label className="form-label">Name *</label><input type="text" className="form-input" placeholder="Category name" value={catForm.name} onChange={e => setCatForm({...catForm, name:e.target.value})}/></div>
                  <div className="form-group">
                    <label className="form-label">Type *</label>
                    <select className="form-select" value={catForm.type} onChange={e => setCatForm({...catForm, type:e.target.value as Category['type']})}>
                      {['income','expense','transfer','saving','all'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Default account (optional)</label>
                    <select className="form-select" value={catForm.default_account_id} onChange={e => setCatForm({...catForm, default_account_id:e.target.value})}>
                      <option value="">— None —</option>
                      {accounts.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <p className="form-hint">When you choose this category on a transaction, this account fills in automatically.</p>
                  </div>
                  <div className="form-group"><label className="form-label">Color</label><input type="color" className="form-input h-10" value={catForm.color} onChange={e => setCatForm({...catForm, color:e.target.value})}/></div>
                  <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" className="w-4 h-4 accent-blue-600" checked={catForm.include_in_budget} onChange={e => setCatForm({...catForm, include_in_budget:e.target.checked})}/>Include in Budget</label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" className="w-4 h-4 accent-blue-600" checked={catForm.is_active} onChange={e => setCatForm({...catForm, is_active:e.target.checked})}/>Active</label>
                </div>
                <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
                  <button onClick={() => setShowCatForm(false)} className="btn-md btn-secondary">Cancel</button>
                  <button onClick={saveCat} className="btn-md btn-primary"><Check size={16}/> {editingCat?'Update':'Add'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* OWNERS TAB */}
      {tab==='owners' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm" style={{ color:'var(--text-secondary)' }}>{owners.length} owners/purposes</p>
            <button onClick={openNewOwner} className="btn-md btn-primary"><Plus size={16}/> Add Owner</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {owners.map(o => (
              <div key={o.id} className="card card-p flex items-center gap-3 group">
                <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background:o.color+'20', color:o.color }}>
                  <User size={16}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{o.name}</p>
                  {o.description && <p className="text-xs truncate" style={{ color:'var(--text-muted)' }}>{o.description}</p>}
                  {!o.is_active && <span className="badge badge-gray text-[10px]">Inactive</span>}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEditOwner(o)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13}/></button>
                </div>
              </div>
            ))}
          </div>
          {showOwnerForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'var(--bg-overlay)' }}>
              <div className="card w-full max-w-md animate-fade-in-up">
                <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
                  <h2 className="text-lg font-semibold">{editingOwner?'Edit Owner':'Add Owner'}</h2>
                  <button onClick={() => setShowOwnerForm(false)} className="btn-icon"><X size={18}/></button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="form-group"><label className="form-label">Name *</label><input type="text" className="form-input" placeholder="e.g. Business" value={ownerForm.name} onChange={e => setOwnerForm({...ownerForm, name:e.target.value})}/></div>
                  <div className="form-group"><label className="form-label">Description</label><input type="text" className="form-input" placeholder="Optional description" value={ownerForm.description} onChange={e => setOwnerForm({...ownerForm, description:e.target.value})}/></div>
                  <div className="form-group"><label className="form-label">Color</label><input type="color" className="form-input h-10" value={ownerForm.color} onChange={e => setOwnerForm({...ownerForm, color:e.target.value})}/></div>
                  <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" className="w-4 h-4 accent-blue-600" checked={ownerForm.is_active} onChange={e => setOwnerForm({...ownerForm, is_active:e.target.checked})}/>Active</label>
                </div>
                <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
                  <button onClick={() => setShowOwnerForm(false)} className="btn-md btn-secondary">Cancel</button>
                  <button onClick={saveOwner} className="btn-md btn-primary"><Check size={16}/> {editingOwner?'Update':'Add'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Data Export Section */}
      <div className="card card-p space-y-3">
        <h3 className="section-title">Data Export</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Export all your data as a JSON backup file.</p>
        <button onClick={handleExportData} disabled={exporting} className="btn-md btn-secondary flex items-center gap-2">
          {exporting ? <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"/> : <Download size={16}/>}
          {exporting ? 'Exporting…' : 'Export All Data (JSON)'}
        </button>
      </div>

      {/* PREFERENCES TAB */}
      {tab==='preferences' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card card-p space-y-5">
            <h3 className="section-title text-base">Appearance</h3>
            <div className="form-group">
              <label className="form-label">Theme</label>
              <select className="form-select" value={prefForm.theme} onChange={e => setPrefForm({...prefForm, theme:e.target.value as any})}>
                <option value="light">☀️ Light</option>
                <option value="dark">🌙 Dark</option>
                <option value="system">💻 System</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Font</label>
              <select className="form-select" value={prefForm.font_choice} onChange={e => setPrefForm({...prefForm, font_choice:e.target.value as any})}>
                <option value="dm-sans">DM Sans (Default)</option>
                <option value="nunito">Nunito (Rounded)</option>
                <option value="outfit">Outfit (Modern)</option>
                <option value="poppins">Poppins (Clean)</option>
                <option value="inter">Inter (Technical)</option>
              </select>
            </div>
            <h3 className="section-title text-base pt-2 border-t border-slate-100 dark:border-slate-700">Currency</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="form-label">Currency Code</label>
                <select className="form-select" value={prefForm.currency} onChange={e => { const map: Record<string,string> = { INR:'₹', USD:'$', EUR:'€', GBP:'£', JPY:'¥', AED:'د.إ', SGD:'S$' }; setPrefForm({...prefForm, currency:e.target.value, currency_symbol:map[e.target.value]??'₹'}); }}>
                  <option value="INR">INR — Indian Rupee</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — British Pound</option>
                  <option value="JPY">JPY — Japanese Yen</option>
                  <option value="AED">AED — UAE Dirham</option>
                  <option value="SGD">SGD — Singapore Dollar</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Symbol Preview</label>
                <input type="text" className="form-input" value={`${prefForm.currency_symbol}1,00,000`} readOnly/>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Safe-to-Spend Buffer ({prefForm.currency_symbol})</label>
              <input type="number" className="form-input" value={prefForm.safe_spend_buffer} onChange={e => setPrefForm({...prefForm, safe_spend_buffer:+e.target.value})} min="0" step="1000"/>
              <p className="form-hint">Amount reserved from spendable balance as emergency buffer</p>
            </div>
            <h3 className="section-title text-base pt-2 border-t border-slate-100 dark:border-slate-700">Automation</h3>
            <label className="flex items-start gap-2 cursor-pointer text-sm">
              <input type="checkbox" className="w-4 h-4 mt-0.5 accent-blue-600" checked={prefForm.sweep_enabled} onChange={e => setPrefForm({...prefForm, sweep_enabled:e.target.checked})}/>
              <span>
                Auto-sweep leftover into savings on payday
                <span className="block text-xs mt-0.5" style={{ color:'var(--text-muted)' }}>When you add a salary for the current month, move whatever is left in that account into your savings bucket so it resets to just the new salary. You&apos;ll be asked to confirm each time.</span>
              </span>
            </label>
            <button onClick={savePrefs} disabled={savingPrefs} className="btn-md btn-primary w-full mt-2">
              {savingPrefs ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : <Check size={16}/>}
              {savingPrefs ? 'Saving…' : 'Save Preferences'}
            </button>
          </div>

          <div className="card card-p space-y-4">
            <h3 className="section-title text-base">Data Management</h3>
            <div className="space-y-3">
              <button onClick={exportAllData} className="btn-md btn-secondary w-full justify-start gap-3"><Download size={16}/>Export All Data (JSON backup)</button>
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm space-y-1">
                <p className="font-medium">Data Statistics</p>
                <p style={{ color:'var(--text-muted)' }}>{income.length} income entries</p>
                <p style={{ color:'var(--text-muted)' }}>{transactions.length} transactions</p>
                <p style={{ color:'var(--text-muted)' }}>{accounts.length} accounts</p>
                <p style={{ color:'var(--text-muted)' }}>{categories.length} categories</p>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
                <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">Data Safety</p>
                <p style={{ color:'var(--text-secondary)' }}>All data is synced to your private Supabase database. Deactivating accounts or categories never deletes historical data — old transactions remain intact.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
