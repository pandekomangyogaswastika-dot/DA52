/**
 * BundleScannerModal — Thin wrapper di atas UniversalScanner
 * Sprint A.1: Refactored to use UniversalScanner SSOT.
 * Business logic (bundle resolution via API) tetap di sini.
 */
import { useState, useCallback } from 'react';
import UniversalScanner from './scanner/UniversalScanner';

export default function BundleScannerModal({ token, onDetected, onClose }) {
  const [loading,  setLoading]  = useState(false);
  const [scanError, setScanError] = useState('');

  const resolveBundleByNumber = useCallback(async (bundleNumber) => {
    const cleaned = String(bundleNumber || '').trim().toUpperCase();
    if (!cleaned) throw new Error('Bundle number kosong');
    const res = await fetch(
      `/api/rahaza/bundles/by-number/${encodeURIComponent(cleaned)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) throw new Error(`Bundle "${cleaned}" tidak ditemukan`);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || ''; } catch (_) { /* noop */ }
      throw new Error(detail || `Gagal mengambil bundle (HTTP ${res.status})`);
    }
    return await res.json();
  }, [token]);

  const handleScan = useCallback(async (code, source) => {
    setScanError('');
    setLoading(true);
    try {
      const bundle = await resolveBundleByNumber(code);
      if (onDetected) onDetected(bundle, { payload: code, source });
      onClose?.();
    } catch (e) {
      setScanError(e.message || 'Gagal mengambil bundle');
    } finally {
      setLoading(false);
    }
  }, [resolveBundleByNumber, onDetected, onClose]);

  return (
    <>
      <UniversalScanner
        variant="modal"
        open={true}
        onClose={onClose}
        title="Scan Bundle"
        onScan={loading ? undefined : handleScan}
        data-testid="bundle-scanner-modal"
      />
      {scanError && (
        <div className="fixed bottom-4 right-4 z-[9999] bg-red-500/20 border border-red-300/30 rounded-lg p-3 text-xs text-red-200 max-w-xs shadow-xl">
          {scanError}
        </div>
      )}
    </>
  );
}
