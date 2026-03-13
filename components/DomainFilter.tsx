import React from 'react';
import { DOMAINS_LIST, DomainId } from '../domains';

interface Props {
  active: DomainId;
  onChange: (active: DomainId) => void;
  counts?: Record<string, number>;
}

/**
 * Compact pill-style domain selector.
 * Renders horizontally with icon, label (short) and optional count badge.
 */
export const DomainFilter: React.FC<Props> = ({ active, onChange, counts = {} }) => {
  const select = (id: DomainId) => {
    if (active === id) return; // already selected
    onChange(id);
  };

  return (
    <div className="bg-white/90 backdrop-blur-sm p-1 rounded-full shadow flex items-center gap-1">
      {DOMAINS_LIST.map(d => {
        const isActive = active === d.id;
        const count = counts[d.id] || 0;
        return (
          <button
            key={d.id}
            onClick={() => select(d.id)}
            title={`${d.label} (${count})`}
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 focus:outline-none` +
              (isActive ? ` ring-2 ring-offset-1` : ` opacity-80 hover:opacity-100`)}
            style={{
              border: isActive ? `1px solid ${d.color || '#000'}` : '1px solid transparent',
              background: isActive ? `${d.color || '#000'}20` : 'transparent'
            }}
          >
            <span className="whitespace-nowrap">{d.label}</span>
            <span className="ml-1 text-[10px] px-1 rounded bg-white text-slate-600" style={{ minWidth: 18, textAlign: 'center' }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
};

export default DomainFilter;
