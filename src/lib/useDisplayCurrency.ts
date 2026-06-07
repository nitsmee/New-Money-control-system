'use client';
import { useEffect, useState } from 'react';

// The "display currency" is a UI-only choice (persisted in localStorage) that
// lets the user flip dashboard/report totals between, say, INR and THB. It
// defaults to the account's base currency. Changing it broadcasts an event so
// every component using this hook updates together.

const KEY = 'mcs_display_currency';
const EVT = 'mcs-currency-change';

export function getDisplayCurrency(base: string): string {
  if (typeof window === 'undefined') return base;
  return localStorage.getItem(KEY) || base;
}

export function setDisplayCurrency(code: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, code);
  window.dispatchEvent(new CustomEvent(EVT, { detail: code }));
}

// Reactive hook. Pass the base currency; returns [displayCurrency, setter].
export function useDisplayCurrency(base: string): [string, (c: string) => void] {
  const [cur, setCur] = useState(base);

  useEffect(() => {
    setCur(getDisplayCurrency(base));
    const onChange = (e: Event) => setCur((e as CustomEvent).detail || base);
    window.addEventListener(EVT, onChange as EventListener);
    return () => window.removeEventListener(EVT, onChange as EventListener);
  }, [base]);

  return [cur, setDisplayCurrency];
}
