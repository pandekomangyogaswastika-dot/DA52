import ErrorBoundary from './ErrorBoundary';

/**
 * Specialized ErrorBoundary for individual modules
 * Provides more granular error isolation
 */
export default function ModuleErrorBoundary({ children, moduleName }) {
  const handleError = (error, errorInfo) => {
    console.error(`Module "${moduleName}" error:`, error, errorInfo);
  };

  return (
    <ErrorBoundary 
      level="module" 
      onError={handleError}
    >
      {children}
    </ErrorBoundary>
  );
}
