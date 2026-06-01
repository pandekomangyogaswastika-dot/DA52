/**
 * Test Utils — wraps render() with required providers (TooltipProvider, etc.)
 * for components that use Radix UI primitives requiring context.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

function AllProviders({ children }) {
  return (
    <TooltipProvider delayDuration={0}>
      {children}
    </TooltipProvider>
  );
}

export function renderWithProviders(ui, options = {}) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export common testing-library helpers for convenience
export * from '@testing-library/react';
