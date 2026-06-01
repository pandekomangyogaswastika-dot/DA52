import { useState, useEffect, useCallback } from 'react';
import { BookOpen, X, AlertTriangle, FileText, ImageIcon, Link, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';

/* ─── SOPModal — Operator SOP viewer (Phase 18D) ───────────────────────────────
   Opens when operator taps "SOP" button in OperatorView.
   Fetches SOP by model_id + process_id, shows markdown + attachments.
 ────────────────────────────────────────────────────────────────────── */

// Simple markdown renderer (bold, italic, headers, bullet lists, horizontal lines)
function MarkdownContent({ content }) {
  if (!content) return null;
  const lines = content.split('\n');
  const elements = [];
  let listBuffer = [];

  const flushList = (key) => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`list-${key}`} className="list-disc list-inside space-y-1 pl-2 my-2">
          {listBuffer.map((item, i) => (
            <li key={i} className="text-sm text-foreground/85">{renderInline(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  const renderInline = (text) => {
    // Bold: **text**
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
      }
      // Italic: *text*
      const italicParts = part.split(/(\*[^*]+\*)/g);
      return italicParts.map((p, j) => {
        if (p.startsWith('*') && p.endsWith('*')) {
          return <em key={j} className="italic text-foreground/80">{p.slice(1, -1)}</em>;
        }
        return <span key={j}>{p}</span>;
      });
    });
  };

  lines.forEach((line, idx) => {
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushList(idx);
      elements.push(<hr key={idx} className="border-[var(--glass-border)] my-3" />);
      return;
    }
    // H1
    if (line.startsWith('# ')) {
      flushList(idx);
      elements.push(<h1 key={idx} className="text-lg font-bold text-foreground mt-3 mb-1">{line.slice(2)}</h1>);
      return;
    }
    // H2
    if (line.startsWith('## ')) {
      flushList(idx);
      elements.push(<h2 key={idx} className="text-base font-semibold text-foreground mt-3 mb-1">{line.slice(3)}</h2>);
      return;
    }
    // H3
    if (line.startsWith('### ')) {
      flushList(idx);
      elements.push(<h3 key={idx} className="text-sm font-semibold text-foreground mt-2 mb-0.5">{line.slice(4)}</h3>);
      return;
    }
    // List item
    if (line.startsWith('- ') || line.startsWith('* ')) {
      listBuffer.push(line.slice(2));
      return;
    }
    // Numbered list
    const numMatch = line.match(/^(\d+)\. (.+)/);
    if (numMatch) {
      flushList(idx);
      elements.push(
        <div key={idx} className="flex gap-2 my-1">
          <span className="text-xs font-semibold text-[hsl(var(--primary))] mt-0.5 flex-shrink-0 min-w-[20px]">{numMatch[1]}.</span>
          <p className="text-sm text-foreground/85">{renderInline(numMatch[2])}</p>
        </div>
      );
      return;
    }
    // Empty line
    if (!line.trim()) {
      flushList(idx);
      elements.push(<div key={idx} className="h-2" />);
      return;
    }
    // Normal paragraph
    flushList(idx);
    elements.push(<p key={idx} className="text-sm text-foreground/85 my-1">{renderInline(line)}</p>);
  });
  flushList('end');

  return <div className="space-y-0.5">{elements}</div>;
}

export default function SOPModal({ token, modelId, processId, modelCode, processCode, onClose }) {
  const [sop, setSop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAttachments, setShowAttachments] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const loadSOP = useCallback(async () => {
    if (!modelId || !processId) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(
        `/api/rahaza/sop/by-context?model_id=${encodeURIComponent(modelId)}&process_id=${encodeURIComponent(processId)}`,
        { headers }
      );
      if (!r.ok) throw new Error();
      const data = await r.json();
      setSop(data.sop);
    } catch (_) {
      setSop(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, processId, token]);

  useEffect(() => { loadSOP(); }, [loadSOP]);

  const titleStr = sop?.title || `SOP ${modelCode || modelId} · ${processCode || processId}`;

  return (
    <Modal
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[hsl(var(--primary))]" />
          <span>{titleStr}</span>
        </div>
      }
      size="lg"
    >
      <div className="space-y-4" data-testid="sop-modal">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--primary))]" />
          </div>
        ) : !sop ? (
          <div className="text-center py-8">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-foreground/20" />
            <p className="text-sm font-medium text-foreground">Belum ada SOP untuk proses ini</p>
            <p className="text-xs text-muted-foreground mt-1">
              {modelCode || modelId} · {processCode || processId}
            </p>
            <p className="text-xs text-muted-foreground mt-2">Hubungi admin untuk menambahkan instruksi kerja.</p>
          </div>
        ) : (
          <>
            {/* Meta strip */}
            <div className="flex items-center gap-3 text-xs bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-3 py-2">
              <span className="text-muted-foreground">Model:</span>
              <span className="font-medium text-foreground">{sop.model_code} — {sop.model_name || ''}</span>
              <span className="text-muted-foreground ml-2">Proses:</span>
              <span className="font-medium text-foreground">{sop.process_code} — {sop.process_name || ''}</span>
              <span className="ml-auto text-muted-foreground">v{sop.version}</span>
            </div>

            {/* SOP content */}
            {sop.content_markdown ? (
              <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-4 py-3 min-h-[80px]">
                <MarkdownContent content={sop.content_markdown} />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic text-center py-4">
                Tidak ada teks instruksi — lihat lampiran di bawah.
              </div>
            )}

            {/* Attachments */}
            {(sop.attachments || []).length > 0 && (
              <div>
                <button
                  onClick={() => setShowAttachments(!showAttachments)}
                  className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--primary))] mb-2"
                  data-testid="sop-attachments-toggle"
                >
                  {showAttachments ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Lampiran ({sop.attachments.length})
                </button>
                {showAttachments && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="sop-attachments-list">
                    {sop.attachments.map((att, i) => {
                      const isImage = att.type?.startsWith('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(att.url || att.name || '');
                      return (
                        <a
                          key={i}
                          href={att.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-1 p-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] transition-colors text-center"
                          data-testid={`sop-attachment-${i}`}
                        >
                          {isImage ? (
                            <img
                              src={att.url}
                              alt={att.name || 'Lampiran'}
                              className="w-full max-h-32 object-cover rounded"
                              onError={e => { e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <FileText className="w-8 h-8 text-muted-foreground" />
                          )}
                          <span className="text-[10px] text-foreground/70 truncate w-full">{att.name || `Lampiran ${i + 1}`}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-9">
            <X className="w-4 h-4 mr-1.5" /> Tutup
          </Button>
        </div>
      </div>
    </Modal>
  );
}
