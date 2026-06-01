import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/* ─── PT Rahaza ERP · ContextualTooltip (Phase 16.4) ──────────────────────────
   Helper ringan untuk tooltip kontekstual di sebelah label field / header.
   Dipakai untuk memberi "apa ini" + "dampak bisnis" dalam 1-2 kalimat.

   Usage:
     <label className="flex items-center gap-1.5">
       Due Date
       <ContextualTooltip
         what="Target kirim ke pelanggan."
         why="Jika Work Order completed setelah tanggal ini, order masuk kategori delay dan kena penalty on-time-rate."
       />
     </label>

   Props:
     - what: string    (1 kalimat definisi)
     - why: string     (1 kalimat dampak / kenapa penting)
     - size: 'xs' | 'sm' | 'md' (default 'xs')
     - children: override trigger (optional)
───────────────────────────────────────────────────────────────────────────── */

const SIZE_MAP = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
};

export function ContextualTooltip({ what, why, size = 'xs', children, ...rest }) {
  const trigger = children || (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary)/0.4)]"
      aria-label="Info"
      tabIndex={0}
      onClick={(e) => e.preventDefault()}
      {...rest}
    >
      <HelpCircle className={SIZE_MAP[size] || SIZE_MAP.xs} />
    </button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-xs p-2.5 text-[11px] leading-relaxed bg-[var(--glass-bg)] backdrop-blur-lg border border-[var(--glass-border)] shadow-lg"
        >
          {what && <div className="text-foreground font-medium mb-1">{what}</div>}
          {why && <div className="text-muted-foreground">{why}</div>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default ContextualTooltip;
