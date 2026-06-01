/**
 * RecentModulesFooter — shows last 5 visited modules in sidebar footer.
 * Persists to localStorage per-portal.
 */

import { useState, useEffect } from 'react';
import { PORTAL_NAV, findModuleLabel } from './portalNav';

const MAX = 5;

export default function RecentModulesFooter({ portal, currentModule, onModuleChange }) {
  const STORAGE_KEY = `erp_recent_${portal}`;

  const [recent, setRecent] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  // Update recent list when module changes
  useEffect(() => {
    if (!currentModule) return;
    setRecent((prev) => {
      const next = [currentModule, ...prev.filter((m) => m !== currentModule)].slice(0, MAX);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModule, portal]);

  // Show only those NOT currently active, max 4 items
  const shown = recent.filter((m) => m !== currentModule).slice(0, 4);
  if (shown.length === 0) return null;

  return (
    <div className="mb-1">
      <p className="text-[10px] text-foreground/30 uppercase tracking-wider mb-1">Terakhir</p>
      <div className="space-y-0.5">
        {shown.map((modId) => (
          <button
            key={modId}
            onClick={() => onModuleChange?.(modId)}
            className="w-full text-left px-2 py-1 rounded-md text-[11px] text-foreground/50 hover:text-foreground hover:bg-[var(--glass-bg-hover)] transition-colors duration-150 truncate"
            data-testid={`recent-module-${modId}`}
            title={modId}
          >
            {Object.keys(PORTAL_NAV).reduce((found, pid) => {
              if (found !== modId) return found;
              return findModuleLabel(pid, modId);
            }, modId)}
          </button>
        ))}
      </div>
    </div>
  );
}
