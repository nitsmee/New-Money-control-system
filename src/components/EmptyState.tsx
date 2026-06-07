'use client';
import { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="card card-p flex flex-col items-center justify-center text-center py-14 gap-3">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-1" style={{ background: 'var(--bg-subtle)' }}>
        <Icon size={28} style={{ color: 'var(--text-muted)' }} />
      </div>
      <h3 className="font-semibold text-base">{title}</h3>
      <p className="text-sm max-w-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn-md btn-primary mt-2">{action.label}</button>
      )}
    </div>
  );
}
