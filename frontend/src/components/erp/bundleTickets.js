/**
 * PT Rahaza ERP — Bundle Ticket helpers (Phase 17B)
 *
 * The backend serves ticket PDFs as authenticated endpoints, so we cannot just
 * set href="/api/..." on an <a>/window.open (no Authorization header).
 * These helpers fetch the PDF as a blob with the Bearer token, then open/download.
 */
import { toast } from 'sonner';

async function fetchPdfBlob(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err.detail || err.message || '';
    } catch (_) {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(detail || `Gagal generate PDF (HTTP ${res.status})`);
  }
  return await res.blob();
}

function triggerOpen(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  // Open in a new tab so operator can print from browser preview.
  const w = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  if (!w) {
    // Popup blocked → fallback to a download anchor.
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/** Open single-bundle ticket PDF in a new tab. */
export async function openBundleTicket(bundle, token) {
  try {
    const blob = await fetchPdfBlob(
      `/api/rahaza/bundles/${bundle.id}/ticket.pdf`,
      token,
    );
    triggerOpen(blob, `bundle-ticket-${bundle.bundle_number || bundle.id}.pdf`);
    toast.success(`Ticket ${bundle.bundle_number || ''} siap dicetak`);
  } catch (e) {
    toast.error(e.message || 'Gagal buka ticket');
  }
}

/** Open bulk bundle tickets PDF (all bundles for a WO) in a new tab. */
export async function openWorkOrderBundleTickets(workOrder, token, opts = {}) {
  try {
    const qp = new URLSearchParams();
    if (opts.status) qp.set('status', opts.status);
    const qs = qp.toString();
    const woId = workOrder?.id || workOrder;
    const woLabel = workOrder?.wo_number || workOrder?.wo_number_snapshot || woId;
    const blob = await fetchPdfBlob(
      `/api/rahaza/work-orders/${woId}/bundle-tickets.pdf${qs ? `?${qs}` : ''}`,
      token,
    );
    triggerOpen(blob, `bundle-tickets-${woLabel}.pdf`);
    toast.success('Bulk ticket siap dicetak');
  } catch (e) {
    toast.error(e.message || 'Gagal buka bulk ticket');
  }
}
