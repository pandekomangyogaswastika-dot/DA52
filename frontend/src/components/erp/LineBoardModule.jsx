import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Factory, Target, Users, Timer, Layers, TrendingUp, AlertCircle } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import { motion } from 'framer-motion';

// Line Board
//  - Card per proses (Rajut → Packing; rework dikecualikan untuk board utama).
//  - Setiap proses menampilkan line-line beserta assignment aktif + output hari ini.
//  - Aksi cepat: Tambah Output (menambah WIP event di line).

export default function LineBoardModule({ token, user, onNavigate }) {
  const [board, setBoard] = useState([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const [outputModal, setOutputModal] = useState(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rahaza/line-board?assign_date=${date}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setBoard(data.board || []);
        setUpdatedAt(new Date().toLocaleTimeString('id-ID'));
      }
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, token]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(fetchBoard, 30000);
    return () => clearInterval(t);
  }, [fetchBoard]);

  const handleAddOutput = (line, proc, assign) => {
    setOutputModal({ line, proc, assign, qty: '' });
  };

  const submitOutput = async () => {
    if (!outputModal) return;
    const { line, proc, assign, qty } = outputModal;
    const qtyNum = parseInt(qty, 10);
    if (!qtyNum || qtyNum <= 0) return;
    const body = {
      line_id: line.line_id,
      process_id: proc.process_id,
      qty: qtyNum,
      event_type: 'output',
    };
    if (assign) {
      body.line_assignment_id = assign.id;
      body.model_id = assign.model_id;
      body.size_id  = assign.size_id;
    }
    const res = await fetch('/api/rahaza/wip/events', { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) {
      setOutputModal(null);
      fetchBoard();
    }
  };

  if (loading && board.length === 0) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  );

  return (
    <div className="space-y-5" data-testid="line-board-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Line Board</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kanban real-time per proses. Menampilkan assignment operator, target, dan output hari ini.
            Auto-refresh tiap 30 detik.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GlassInput
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="h-9 w-auto"
            data-testid="line-board-date"
          />
          <Button variant="ghost" onClick={fetchBoard} className="gap-1.5" data-testid="line-board-refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-xs">Muat Ulang</span>
          </Button>
          {updatedAt && <span className="text-xs text-muted-foreground">Diperbarui: {updatedAt}</span>}
        </div>
      </div>

      {/* Process columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {board.map((proc, pi) => (
          <motion.div
            key={proc.process_id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: pi * 0.04 }}
          >
            <GlassPanel className="p-4 h-full">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-primary bg-primary/15 px-2 py-0.5 rounded-full">
                    #{proc.order_seq}
                  </span>
                  <h3 className="text-base font-semibold text-foreground">{proc.process_name}</h3>
                </div>
                <span className="text-xs text-muted-foreground">{proc.lines.length} line</span>
              </div>
              <div className="space-y-2">
                {proc.lines.length === 0 ? (
                  <div className="text-xs text-muted-foreground/70 py-6 text-center border border-dashed border-[var(--glass-border)] rounded-lg flex flex-col items-center gap-2">
                    <span>Belum ada line untuk proses {proc.process_name}</span>
                    {onNavigate && (
                      <button
                        onClick={() => onNavigate('prod-lines')}
                        className="text-[10px] underline text-primary hover:text-primary/80"
                        data-testid={`lb-add-line-${proc.process_code}`}
                      >
                        + Tambah Line
                      </button>
                    )}
                  </div>
                ) : proc.lines.map(line => {
                  const assign = line.assignments[0]; // main assignment (if multiple shifts, take first)
                  const target = assign?.target_qty || 0;
                  const pct = target > 0 ? Math.min(100, Math.round((line.output_today / target) * 100)) : 0;
                  return (
                    <GlassCard
                      key={line.line_id}
                      className="p-3"
                      data-testid={`line-board-card-${line.line_code}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-foreground">{line.line_code}</span>
                            <span className="text-[10px] text-muted-foreground truncate">{line.line_name}</span>
                          </div>
                          {line.location_name && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">▸ {line.location_name}</div>
                          )}
                        </div>
                        <button
                          onClick={() => handleAddOutput(line, proc, assign)}
                          className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 flex items-center justify-center"
                          title="Tambah output"
                          data-testid={`line-add-output-${line.line_code}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {assign ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Users className="w-3 h-3" />
                            <span className="truncate">{assign.operator_name || '—'}</span>
                            {assign.shift_name && <span className="ml-auto flex items-center gap-1"><Timer className="w-3 h-3" /> {assign.shift_name}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Layers className="w-3 h-3" />
                            <span className="truncate">{assign.model_name || '—'}{assign.size_code ? ` · ${assign.size_code}` : ''}</span>
                          </div>
                          {/* Progress bar */}
                          <div>
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span className="text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" /> {line.output_today}/{target}</span>
                              <span className={`font-semibold ${pct >= 100 ? 'text-emerald-300' : pct >= 50 ? 'text-primary' : 'text-amber-300'}`}>{pct}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-400' : pct >= 50 ? 'bg-primary' : 'bg-amber-400'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {line.output_today > 0 ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-[10px] text-emerald-300 py-1">
                                <TrendingUp className="w-3 h-3" />
                                <span>Ada output tanpa assignment formal</span>
                              </div>
                              {onNavigate && (
                                <button
                                  onClick={() => onNavigate('prod-assignments')}
                                  className="text-[10px] underline text-primary hover:text-primary/80"
                                  data-testid={`lb-assign-${line.line_code}`}
                                >
                                  Assign →
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-[10px] text-amber-300 py-1">
                                <AlertCircle className="w-3 h-3" />
                                <span>Belum ada assignment hari ini</span>
                              </div>
                              {onNavigate && (
                                <button
                                  onClick={() => onNavigate('prod-assignments')}
                                  className="text-[10px] underline text-primary hover:text-primary/80"
                                  data-testid={`lb-assign-${line.line_code}`}
                                >
                                  Assign →
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-2 pt-2 border-t border-[var(--glass-border)] flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Output hari ini: <b className="text-foreground">{line.output_today}</b> pcs</span>
                        {line.capacity_per_hour > 0 && (
                          <span>Kapasitas {line.capacity_per_hour}/jam</span>
                        )}
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            </GlassPanel>
          </motion.div>
        ))}
      </div>

      {/* Add output modal */}
      {outputModal && (
        <Modal onClose={() => setOutputModal(null)} title={`Tambah Output · ${outputModal.line.line_code}`}>
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Proses:</span> <b>{outputModal.proc.process_name}</b></div>
              <div><span className="text-muted-foreground">Line:</span> <b>{outputModal.line.line_name}</b></div>
              {outputModal.assign && (
                <>
                  <div><span className="text-muted-foreground">Operator:</span> <b>{outputModal.assign.operator_name || '-'}</b></div>
                  <div><span className="text-muted-foreground">Model/Size:</span> <b>{outputModal.assign.model_name || '-'} {outputModal.assign.size_code || ''}</b></div>
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/70 mb-1.5">Jumlah pcs <span className="text-red-400">*</span></label>
              <GlassInput
                type="number"
                autoFocus
                value={outputModal.qty}
                onChange={e => setOutputModal({ ...outputModal, qty: e.target.value })}
                placeholder="Contoh: 25"
                data-testid="output-qty-input"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOutputModal(null)}>Batal</Button>
              <Button onClick={submitOutput} disabled={!outputModal.qty} data-testid="output-submit-btn">
                <Factory className="w-4 h-4 mr-1.5" /> Catat Output
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
