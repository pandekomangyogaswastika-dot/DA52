/**
 * ProductionInputFAB — Floating Action Button untuk Quick Input
 * Selalu visible di pojok kanan bawah ketika user ada di Production portal.
 * Keyboard shortcut: Alt+I
 */
import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useProductionUI } from '@/contexts/ProductionUIContext';

export default function ProductionInputFAB() {
  const { openQuickInput } = useProductionUI();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey && e.key === 'i') {
        e.preventDefault();
        openQuickInput();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openQuickInput]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => openQuickInput()}
            className="fixed bottom-5 right-5 h-12 w-12 md:h-14 md:w-14 rounded-full bg-primary text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.5)] hover:shadow-[0_0_28px_hsl(var(--primary)/0.7)] transition-all z-50"
            data-testid="quick-input-fab"
          >
            <Plus className="w-6 h-6" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Quick Input (Alt+I)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
