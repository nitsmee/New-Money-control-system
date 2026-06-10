'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/appStore';
import {
  LayoutDashboard, TrendingUp, ArrowLeftRight, Repeat, PieChart, Target,
  BarChart3, Settings, Bell, LogOut, Menu, X, ChevronLeft, Sun, Moon,
  Monitor, Wallet, Landmark, Search, CalendarClock, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { GlobalSearch } from '@/components/GlobalSearch';
import { SessionWarning } from '@/components/SessionWarning';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FinanceBot } from '@/components/FinanceBot';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ConfirmProvider } from '@/components/ConfirmDialog';

const NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, key: 'D' },
  { label: 'Accounts', href: '/dashboard/accounts', icon: Landmark, key: 'A' },
  { label: 'Income', href: '/dashboard/income', icon: TrendingUp, key: 'I' },
  { label: 'Recurring Income', href: '/dashboard/recurring-income', icon: CalendarClock, key: '' },
  { label: 'Transactions', href: '/dashboard/transactions', icon: ArrowLeftRight, key: 'T' },
  { label: 'Fixed Expenses', href: '/dashboard/fixed-expenses', icon: Repeat, key: '' },
  { label: 'Budget', href: '/dashboard/budget', icon: PieChart, key: 'B' },
  { label: 'Goals', href: '/dashboard/goals', icon: Target, key: 'G' },
  { label: 'Reports', href: '/dashboard/reports', icon: BarChart3, key: 'R' },
  { label: 'Alerts', href: '/dashboard/alerts', icon: Bell, key: '' },
  { label: 'Recycle Bin', href: '/dashboard/recycle-bin', icon: Trash2, key: '' },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings, key: ',' },
];

// The five most-used pages for the mobile bottom bar (full list is in the
// hamburger menu). Reports is here by request; Recurring Income lives in the menu.
const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Transactions', href: '/dashboard/transactions', icon: ArrowLeftRight },
  { label: 'Budget', href: '/dashboard/budget', icon: PieChart },
  { label: 'Reports', href: '/dashboard/reports', icon: BarChart3 },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { sidebarOpen, setSidebarOpen, theme, setTheme, loadAll, settings } = useAppStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ email?: string; name?: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    const init = async () => {
      const sb = createClient();
      const { data: { user: u } } = await sb.auth.getUser();
      if (!u) { router.push('/auth/login'); return; }
      setUser({ email: u.email, name: u.user_metadata?.full_name });
      setUserId(u.id);
      if (!initialized.current) {
        initialized.current = true;
        await loadAll(u.id);
      }
    };
    init();
  }, []);

  // Live multi-tab / multi-device sync via Supabase Realtime. When this user's
  // rows change anywhere (another tab or device), reload the store so the
  // current view stays fresh without a manual refresh. Fails silently if
  // Realtime isn't enabled on the tables yet — no live updates, but no crash.
  useEffect(() => {
    if (!userId) return;

    let channel: RealtimeChannel | null = null;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    // Debounce reloads so a burst of changes (or the user's own writes)
    // coalesces into a single refetch instead of a reload storm.
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        useAppStore.getState().loadAll(userId);
      }, 1500);
    };

    try {
      const sb = createClient();
      const tables = [
        'accounts', 'categories', 'owners', 'income', 'transactions',
        'fixed_expenses', 'budget', 'goals', 'recurring_income', 'user_settings',
      ] as const;

      channel = sb.channel('mcs-realtime');
      for (const table of tables) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
          () => scheduleReload()
        );
      }
      channel.subscribe();
    } catch (e) {
      // A Realtime setup failure must never break the dashboard.
      console.error('Realtime subscription failed:', e);
    }

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      if (channel) {
        try {
          createClient().removeChannel(channel);
        } catch (e) {
          console.error('Realtime cleanup failed:', e);
        }
      }
    };
  }, [userId]);

  // Onboarding check
  useEffect(() => {
    if (localStorage.getItem('mcs_onboarding_done') !== 'true') {
      setShowOnboarding(true);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;
      switch (e.key) {
        case 'd': router.push('/dashboard'); break;
        case 'a': router.push('/dashboard/accounts'); break;
        case 't': router.push('/dashboard/transactions'); break;
        case 'i': router.push('/dashboard/income'); break;
        case 'b': router.push('/dashboard/budget'); break;
        case 'r': router.push('/dashboard/reports'); break;
        case 'g': router.push('/dashboard/goals'); break;
        case ',': router.push('/dashboard/settings'); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else if (theme === 'light') root.classList.remove('dark');
    else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      prefersDark ? root.classList.add('dark') : root.classList.remove('dark');
    }
  }, [theme]);

  // Apply font
  useEffect(() => {
    if (settings?.font_choice) {
      document.documentElement.setAttribute('data-font', settings.font_choice);
    }
  }, [settings?.font_choice]);

  const handleLogout = async () => {
    const sb = createClient();
    await sb.auth.signOut();
    toast.success('Signed out');
    router.push('/auth/login');
  };

  const NavLinks = () => (
    <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
      {NAV.map(({ label, href, icon: Icon, key }) => {
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
              ${active
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
          >
            <Icon size={18} className={active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'} />
            {(sidebarOpen || mobileOpen) && (
              <>
                <span className="flex-1">{label}</span>
                {key && (
                  <span className="hidden lg:inline-block text-[10px] opacity-40 ml-auto font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded">{key}</span>
                )}
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const openSearch = () => window.dispatchEvent(new CustomEvent('mcs-open-search'));

  // Icon-only trigger for compact spots (mobile header, collapsed sidebar).
  const SearchButton = () => (
    <button onClick={openSearch} className="btn-icon" title="Search (⌘K)" aria-label="Search">
      <Search size={16} />
    </button>
  );

  // Wider trigger with a keyboard hint for the desktop sidebar.
  const SearchBar = () => (
    <button
      onClick={openSearch}
      aria-label="Search"
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
    >
      <Search size={16} />
      <span className="flex-1 text-left">Search</span>
      <span className="text-[10px] font-mono opacity-60 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">⌘K</span>
    </button>
  );

  const ThemeCycler = () => {
    const icons = { light: Sun, dark: Moon, system: Monitor };
    const Icon = icons[theme];
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    return (
      <button onClick={() => setTheme(next)} className="btn-icon" title={`Theme: ${theme}`}>
        <Icon size={16} />
      </button>
    );
  };

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-base)',
        backgroundImage:
          'radial-gradient(900px 480px at 100% -8%, color-mix(in srgb, var(--brand-500) 8%, transparent), transparent 60%), radial-gradient(760px 420px at -6% 108%, color-mix(in srgb, var(--success-500) 7%, transparent), transparent 55%)',
      }}
    >
      <GlobalSearch />
      <SessionWarning />
      <OnboardingWizard isOpen={showOnboarding} onComplete={() => { setShowOnboarding(false); localStorage.setItem('mcs_onboarding_done', 'true'); }} />
      {/* Sidebar — Desktop */}
      <aside className={`hidden lg:flex flex-col transition-all duration-300 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ${sidebarOpen ? 'w-64' : 'w-[68px]'}`}>
        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 h-16 border-b border-slate-100 dark:border-slate-700 ${!sidebarOpen ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Wallet size={16} className="text-white" />
          </div>
          {sidebarOpen && <span className="font-bold text-sm leading-tight tracking-tight">Money Control<br /><span className="text-blue-600 text-xs font-medium">System</span></span>}
        </div>
        {/* Search trigger */}
        <div className={`px-3 pt-3 ${!sidebarOpen ? 'flex justify-center' : ''}`}>
          {sidebarOpen ? <SearchBar /> : <SearchButton />}
        </div>
        <NavLinks />
        {/* Bottom controls */}
        <div className={`p-3 border-t border-slate-100 dark:border-slate-700 flex ${sidebarOpen ? 'items-center justify-between' : 'flex-col items-center gap-2'}`}>
          <ThemeCycler />
          {sidebarOpen && user && (
            <div className="flex items-center gap-2 min-w-0 flex-1 mx-2">
              <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                  {(user.name || user.email || 'U')[0].toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user.name || 'User'}</p>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
              </div>
            </div>
          )}
          <button onClick={handleLogout} className="btn-icon text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
        {/* Toggle collapse */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute left-full top-1/2 -translate-y-1/2 translate-x-1 w-5 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-r-lg flex items-center justify-center text-slate-400 hover:text-slate-600 shadow-sm z-10"
        >
          <ChevronLeft size={14} className={`transition-transform duration-300 ${!sidebarOpen ? 'rotate-180' : ''}`} />
        </button>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40" style={{ background: 'var(--bg-overlay)' }} onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile Sidebar */}
      <aside className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-4 h-16 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Wallet size={16} className="text-white" />
            </div>
            <span className="font-bold text-sm">Money Control</span>
          </div>
          <button onClick={() => setMobileOpen(false)} className="btn-icon"><X size={18} /></button>
        </div>
        <NavLinks />
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <ThemeCycler />
          <button onClick={handleLogout} className="btn-icon text-red-400 hover:text-red-600 hover:bg-red-50" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="btn-icon"><Menu size={20} /></button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Wallet size={14} className="text-white" />
            </div>
            <span className="font-bold text-sm">Money Control</span>
          </div>
          <div className="flex items-center gap-1">
            <SearchButton />
            <ThemeCycler />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 animate-fade-in">
          <ConfirmProvider>
            <ErrorBoundary>{children}</ErrorBoundary>
          </ConfirmProvider>
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden flex border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pb-safe">
          {MOBILE_NAV.map(({ label, href, icon: Icon }) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors
                ${active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}>
                <Icon size={20} />
                <span>{label.split(' ')[0]}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <FinanceBot />
      <OfflineBanner />
    </div>
  );
}
