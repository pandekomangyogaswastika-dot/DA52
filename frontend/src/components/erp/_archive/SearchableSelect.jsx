import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export default function SearchableSelect({
  options = [],
  value = '',
  onChange,
  placeholder = '— Pilih —',
  disabled = false,
  className = '',
  required = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find(o => o.value === value);

  const filtered = options.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.label?.toLowerCase().includes(q) ||
      o.sub?.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const handleSelect = (opt) => {
    onChange(opt.value);
    setOpen(false);
    setSearch('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm bg-[var(--input-surface)] text-left transition-all
          ${disabled ? 'opacity-50 cursor-not-allowed border-[var(--glass-border)]' : 'cursor-pointer border-[var(--glass-border)] hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-ring'}
          ${open ? 'border-primary/40 ring-2 ring-primary/15' : ''}`}
      >
        <span className={selected ? 'text-foreground truncate flex-1' : 'text-muted-foreground truncate flex-1'}>
          {selected ? (
            <span className="flex flex-col">
              <span className="font-medium">{selected.label}</span>
              {selected.sub && <span className="text-xs text-muted-foreground">{selected.sub}</span>}
            </span>
          ) : placeholder}
        </span>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {value && !disabled && (
            <span onClick={handleClear} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-xl shadow-xl backdrop-blur-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--glass-border)]">
            <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari..."
              className="flex-1 text-sm text-foreground placeholder-muted-foreground focus:outline-none bg-transparent"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {!required && (
              <button
                type="button"
                onClick={() => handleSelect({ value: '', label: placeholder })}
                className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-[var(--glass-bg-hover)] transition-colors"
              >
                {placeholder}
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground text-center">Tidak ada hasil</div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--glass-bg-hover)] transition-colors flex flex-col
                    ${value === opt.value ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'}`}
                >
                  <span>{opt.label}</span>
                  {opt.sub && <span className="text-xs text-muted-foreground">{opt.sub}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
