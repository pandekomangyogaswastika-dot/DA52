/**
 * UniversalSearch.jsx
 * Phase 3.3 — Cmd+K / Ctrl+K global search modal.
 * Searches: channels, courses, documents, people, messages.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Command } from 'lucide-react';
import { Input } from '../../../ui/input';
import { Badge } from '../../../ui/badge';
import { ScrollArea } from '../../../ui/scroll-area';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const SECTION_CONFIG = {
  channels:  { icon: '#', label: 'Channels',   color: 'bg-blue-100 text-blue-700' },
  courses:   { icon: '📚', label: 'Courses',    color: 'bg-green-100 text-green-700' },
  materials: { icon: '📖', label: 'Materi',     color: 'bg-teal-100 text-teal-700' },
  documents: { icon: '📄', label: 'Dokumen',    color: 'bg-amber-100 text-amber-700' },
  messages:  { icon: '💬', label: 'Pesan',      color: 'bg-purple-100 text-purple-700' },
  people:    { icon: '👤', label: 'Orang',      color: 'bg-rose-100 text-rose-700' },
};

async function doSearch(q, token) {
  if (!q || q.length < 1) return null;
  const res = await fetch(
    `${BACKEND_URL}/api/collab/search?q=${encodeURIComponent(q)}&limit=5`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return res.json();
}

function ResultItem({ icon, title, subtitle, badge, onClick, active }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer rounded-md transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      }`}
      onClick={onClick}
    >
      <span className="text-lg flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${active ? '' : 'text-foreground'}`}>
          {title}
        </p>
        {subtitle && (
          <p className={`text-xs truncate ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
            {subtitle}
          </p>
        )}
      </div>
      {badge && (
        <Badge variant="outline" className="text-xs flex-shrink-0">{badge}</Badge>
      )}
    </div>
  );
}

export default function UniversalSearch({ token, open, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0); // keyboard navigation
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const data = await doSearch(query, token);
      setResults(data);
      setLoading(false);
      setCursor(0);
    }, 280);
  }, [query, token]);

  // Build flat item list for keyboard navigation
  const flatItems = results
    ? Object.entries(SECTION_CONFIG).flatMap(([sectionKey, cfg]) =>
        (results[sectionKey] || []).map(item => ({ ...item, _section: sectionKey, _cfg: cfg }))
      )
    : [];

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flatItems.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && flatItems[cursor]) {
      handleSelect(flatItems[cursor]);
    }
  };

  const handleSelect = (item) => {
    if (!item) return;
    onClose();
    // Navigate based on section type
    if (onNavigate) onNavigate(item._section, item);
  };

  if (!open) return null;

  const hasResults = results && results.total > 0;
  const noResults = results && results.total === 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-[10vh]"
      onClick={onClose}
      data-testid="universal-search-modal"
    >
      <div
        className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <span className="text-xl">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cari channel, course, dokumen, orang..."
            className="flex-1 bg-transparent outline-none text-base placeholder:text-muted-foreground"
            data-testid="search-input"
          />
          {loading && (
            <div className="animate-spin text-muted-foreground text-sm">⟳</div>
          )}
          <kbd className="hidden sm:flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <ScrollArea className="max-h-[60vh]">
          {!query && (
            <div className="p-6 text-center">
              <p className="text-muted-foreground text-sm mb-4">Mulai ketik untuk mencari di seluruh portal</p>
              <div className="grid grid-cols-3 gap-2 max-w-sm mx-auto">
                {Object.entries(SECTION_CONFIG).map(([k, cfg]) => (
                  <div key={k} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{cfg.icon}</span><span>{cfg.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {noResults && (
            <div className="p-8 text-center">
              <div className="text-4xl mb-2">🔍</div>
              <p className="text-muted-foreground">Tidak ada hasil untuk <strong>"{query}"</strong></p>
            </div>
          )}

          {hasResults && (
            <div className="py-2" data-testid="search-results">
              {Object.entries(SECTION_CONFIG).map(([sectionKey, cfg]) => {
                const items = results[sectionKey] || [];
                if (!items.length) return null;
                return (
                  <div key={sectionKey}>
                    <div className="px-4 py-1.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </div>
                    {items.map((item, idx) => {
                      const globalIdx = flatItems.findIndex(
                        fi => fi._section === sectionKey && (fi.channel_id || fi.course_id || fi.doc_id || fi.material_id || fi.message_id || fi.id) ===
                              (item.channel_id || item.course_id || item.doc_id || item.material_id || item.message_id || item.id)
                      );
                      const title = item.name || item.title || item.content?.substring(0, 60) || item.email || '';
                      const subtitle =
                        sectionKey === 'channels' ? item.description || item.type :
                        sectionKey === 'courses'  ? item.category || item.level :
                        sectionKey === 'materials'? item.type || item.description?.substring(0,60) :
                        sectionKey === 'messages' ? `#${item.channel_id?.substring(0,8)} • ${item.sender_name || ''}` :
                        sectionKey === 'people'   ? `${item.position || ''} • ${item.department || ''}` :
                        sectionKey === 'documents'? `Diperbarui: ${item.updated_at?.substring(0,10) || ''}` : '';
                      return (
                        <ResultItem
                          key={`${sectionKey}-${idx}`}
                          icon={cfg.icon}
                          title={title}
                          subtitle={subtitle}
                          active={globalIdx === cursor}
                          onClick={() => handleSelect({ ...item, _section: sectionKey, _cfg: cfg })}
                        />
                      );
                    })}
                  </div>
                );
              })}

              <div className="px-4 py-2 border-t mt-1">
                <p className="text-xs text-muted-foreground">
                  {results.total} hasil untuk "{query}" • ↑↓ navigasi • Enter pilih
                </p>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
