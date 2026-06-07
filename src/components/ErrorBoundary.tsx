'use client';
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: React.ReactNode; fallback?: React.ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="card card-p flex flex-col items-center justify-center gap-3 py-10 text-center">
          <AlertTriangle size={32} className="text-red-400" />
          <h3 className="font-semibold text-base">Something went wrong</h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="btn-md btn-secondary flex items-center gap-2">
            <RefreshCw size={14} /> Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(Component: React.ComponentType<P>) {
  return function WrappedComponent(props: P) {
    return <ErrorBoundary><Component {...props} /></ErrorBoundary>;
  };
}
