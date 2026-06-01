/**
 * useSimpleInputPresets — localStorage hook untuk preset WO + Tahap
 * Dipakai oleh SimpleDailyInputModule.jsx
 * Max 8 preset, deduplikasi by wo_id + process_code
 */
import { useState, useCallback } from 'react';

const KEY = 'dewi_simple_input_presets_v1';
const MAX  = 8;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

export default function useSimpleInputPresets() {
  const [presets, setPresets] = useState(load);

  const savePreset = useCallback(({ id, label, wo_id, wo_number, process_code }) => {
    setPresets(prev => {
      // Hapus duplikat (wo_id + process_code sama)
      const filtered = prev.filter(p => !(p.wo_id === wo_id && p.process_code === process_code));
      const next = [{ id, label, wo_id, wo_number, process_code }, ...filtered].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removePreset = useCallback((presetId) => {
    setPresets(prev => {
      const next = prev.filter(p => p.id !== presetId);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { presets, savePreset, removePreset };
}
