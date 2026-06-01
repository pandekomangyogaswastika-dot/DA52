/**
 * DEPRECATED SHIM — Legacy ThemeContext.
 *
 * The original implementation lived here but lacked a <ThemeProvider>
 * wrapper in the app tree (caused "useTheme must be used within
 * ThemeProvider" runtime errors). All theme state now lives in
 * `/components/theme/ThemeProvider.jsx`. This file remains only as a
 * re-export shim to keep legacy import paths working.
 *
 * New code MUST import from '@/components/theme/ThemeProvider'.
 */
export { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider';
