# ruff: noqa: F401
"""
operations_pdf.py — PDF Export Endpoint
Endpoint: /api/export-pdf

Refactored: Session #11.19 Phase 3.2.6 (split from operations_export.py 1277 LOC)
Split: Excel export → operations_excel.py, PDF configs → operations_pdf_configs.py, PDF helpers → operations_pdf_helpers.py
"""
import uuid
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from database import get_db
from auth import require_auth, log_activity, serialize_doc
from routes.shared import _fmt_date, _fmt_money
from routes.operations_pdf_helpers import (
    _pdf_styles, _pdf_table_style, _pdf_total_row_style, _build_pdf,
    _pdf_header, _pdf_footer, _safe_str, enrich_with_product_photos,
    _get_pdf_config, _filter_columns
)
import logging
from datetime import datetime, timezone
from io import BytesIO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["operations-pdf"])


@router.get("/export-pdf")
async def export_pdf(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    pdf_type = sp.get('type', '')
    config_id = sp.get('config_id')
    try:
        from reportlab.lib.units import mm
        from reportlab.platypus import Table, TableStyle, Paragraph, Spacer
        buf = BytesIO()
        styles = _pdf_styles()
        settings = await db.company_settings.find_one({'type': 'general'}) or {}
        company_name = settings.get('company_name', 'Garment ERP')
        settings.get('pdf_header_line1', '')
        settings.get('pdf_header_line2', '')
        settings.get('pdf_footer_text', '')

        # Get optional custom column config
        config = await _get_pdf_config(db, pdf_type, config_id)

        # ──── PRODUCTION PO (SPP - Surat Perintah Produksi) ────
        if pdf_type == 'production-po':
            po_id = sp.get('id')
            if not po_id:
                raise HTTPException(400, 'id required')
            po = await db.production_pos.find_one({'id': po_id}, {'_id': 0})
            if not po:
                raise HTTPException(404, 'PO not found')
            items = await db.po_items.find({'po_id': po_id}, {'_id': 0}).to_list(500)
            if not items:
                raise HTTPException(404, 'No items in this PO')
            accessories = await db.po_accessories.find({'po_id': po_id}, {'_id': 0}).to_list(500)
            elements = []
            _pdf_header(elements, company_name, 'Surat Perintah Produksi (SPP)', info_pairs=[
                ('No PO', po.get('po_number', '')), ('Customer', po.get('customer_name', '')),
                ('Vendor', po.get('vendor_name', '')), ('Status', po.get('status', '')),
                ('Tanggal PO', _fmt_date(po.get('po_date'))), ('Deadline', _fmt_date(po.get('deadline'))),
                ('Delivery Deadline', _fmt_date(po.get('delivery_deadline'))),
            ])
            # Items table
            all_col_keys = ['no', 'serial', 'product', 'sku', 'size', 'color', 'qty', 'price', 'cmt']
            headers = ['No', 'Serial No', 'Product', 'SKU', 'Size', 'Color', 'Qty', 'Price', 'CMT']
            data_rows = []
            for idx, item in enumerate(items, 1):
                data_rows.append([
                    idx, _safe_str(item.get('serial_number')), _safe_str(item.get('product_name')),
                    _safe_str(item.get('sku')), _safe_str(item.get('size')), _safe_str(item.get('color')),
                    item.get('qty', 0), _fmt_money(item.get('selling_price_snapshot', 0)),
                    _fmt_money(item.get('cmt_price_snapshot', 0))
                ])
            if config and config.get('columns'):
                headers, data_rows = _filter_columns(headers, all_col_keys, config['columns'], data_rows)
            td = [headers] + data_rows
            total_qty = sum(i.get('qty', 0) for i in items)
            total_row = [''] * len(headers)
            total_row[-3] = 'TOTAL'
            total_row[-2] = total_qty if 'qty' in (config or {}).get('columns', all_col_keys) else ''
            td.append(total_row)
            cw = [max(25, int(530 / len(headers)))] * len(headers)
            t = Table(td, colWidths=cw, repeatRows=1)
            t.setStyle(_pdf_table_style())
            t.setStyle(_pdf_total_row_style())
            elements.append(t)
            # Accessories section
            if accessories:
                elements.append(Spacer(1, 6*mm))
                elements.append(Paragraph("<b>Accessories Required:</b>", styles['Heading3']))
                acc_td = [['No', 'Accessory', 'Code', 'Qty Needed', 'Unit', 'Notes']]
                for idx, acc in enumerate(accessories, 1):
                    acc_td.append([idx, acc.get('accessory_name', ''), acc.get('accessory_code', ''),
                                   acc.get('qty_needed', 0), acc.get('unit', 'pcs'), _safe_str(acc.get('notes', ''))])
                at = Table(acc_td, colWidths=[25, 120, 80, 70, 50, 120])
                at.setStyle(_pdf_table_style())
                elements.append(at)
            if po.get('notes'):
                elements.append(Spacer(1, 4*mm))
                elements.append(Paragraph(f"<b>Notes:</b> {po.get('notes', '')}", styles['Normal']))
            _pdf_footer(elements)
            _build_pdf(buf, elements, page='landscape')
            fname = f"SPP-{po.get('po_number', 'unknown')}.pdf"
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename={fname}"})

        # ──── VENDOR SHIPMENT (Surat Jalan Material) ────
        elif pdf_type == 'vendor-shipment':
            sid = sp.get('id')
            if not sid:
                raise HTTPException(400, 'id required')
            ship = await db.vendor_shipments.find_one({'id': sid}, {'_id': 0})
            if not ship:
                raise HTTPException(404, 'Shipment not found')
            items = await db.vendor_shipment_items.find({'shipment_id': sid}, {'_id': 0}).to_list(500)
            elements = []
            _pdf_header(elements, company_name, 'Surat Jalan Material (Vendor Shipment)', info_pairs=[
                ('Shipment No', ship.get('shipment_number', '')), ('Vendor', ship.get('vendor_name', '')),
                ('Type', ship.get('shipment_type', 'NORMAL')), ('Status', ship.get('status', '')),
                ('Date', _fmt_date(ship.get('shipment_date'))),
                ('Inspection', ship.get('inspection_status', 'Pending')),
            ])
            all_col_keys = ['no', 'po', 'serial', 'product', 'sku', 'size', 'color', 'qty_sent']
            headers = ['No', 'PO', 'Serial', 'Product', 'SKU', 'Size', 'Color', 'Qty Sent']
            data_rows = []
            for idx, i in enumerate(items, 1):
                data_rows.append([idx, _safe_str(i.get('po_number')), _safe_str(i.get('serial_number')),
                    _safe_str(i.get('product_name')), _safe_str(i.get('sku')),
                    _safe_str(i.get('size')), _safe_str(i.get('color')), i.get('qty_sent', 0)])
            if config and config.get('columns'):
                headers, data_rows = _filter_columns(headers, all_col_keys, config['columns'], data_rows)
            td = [headers] + data_rows
            total_row = [''] * len(headers)
            total_row[-2] = 'TOTAL'
            total_row[-1] = sum(i.get('qty_sent', 0) for i in items)
            td.append(total_row)
            cw = [max(25, int(445 / len(headers)))] * len(headers)
            t = Table(td, colWidths=cw, repeatRows=1)
            t.setStyle(_pdf_table_style())
            t.setStyle(_pdf_total_row_style())
            elements.append(t)
            # Signature area
            elements.append(Spacer(1, 15*mm))
            sig_data = [['Pengirim (Vendor)', '', 'Penerima'], ['', '', ''], ['_________________', '', '_________________']]
            st = Table(sig_data, colWidths=[180, 100, 180])
            st.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('FONTSIZE', (0, 0), (-1, -1), 9)]))
            elements.append(st)
            _pdf_footer(elements)
            _build_pdf(buf, elements)
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename=SJ-Material-{ship.get('shipment_number','')}.pdf"})

        # ──── VENDOR INSPECTION PDF ────
        elif pdf_type == 'vendor-inspection':
            insp_id = sp.get('id')
            if not insp_id:
                raise HTTPException(400, 'id required')
            insp = await db.vendor_material_inspections.find_one({'id': insp_id}, {'_id': 0})
            if not insp:
                raise HTTPException(404, 'Inspection not found')
            shipment = await db.vendor_shipments.find_one({'id': insp.get('shipment_id')}, {'_id': 0})
            # Get PO info
            po_id = (shipment or {}).get('po_id', '')
            if not po_id:
                first_si = await db.vendor_shipment_items.find_one({'shipment_id': insp.get('shipment_id')})
                if first_si:
                    po_id = first_si.get('po_id', '')
            po = await db.production_pos.find_one({'id': po_id}, {'_id': 0}) if po_id else None
            # Get invoice if linked — FORENSIC_12 GAP-01: legacy `invoices` dropped.
            # Read from rahaza_ap_invoices (SSOT for AP invoices).
            invoice = await db.rahaza_ap_invoices.find_one({'po_id': po_id}, {'_id': 0}) if po_id else None
            # Get all inspection items
            all_insp_items = await db.vendor_material_inspection_items.find({'inspection_id': insp_id}, {'_id': 0}).to_list(500)
            material_items = [i for i in all_insp_items if i.get('item_type') != 'accessory']
            accessory_items = [i for i in all_insp_items if i.get('item_type') == 'accessory']
            # Prefetch product categories in single batch
            mat_pnames = list({(it.get('product_name') or '') for it in material_items if it.get('product_name')})
            mat_categories = {}
            if mat_pnames:
                async for prod in db.products.find(
                    {'product_name': {'$in': mat_pnames}}, {'_id': 0, 'product_name': 1, 'category': 1}
                ):
                    mat_categories[prod['product_name']] = prod.get('category', '-')
            elements = []
            info_pairs = [
                ('No PO', (po or {}).get('po_number', '-')),
                ('No Invoice', (invoice or {}).get('invoice_number', '-')),
                ('Vendor', insp.get('vendor_name', '')),
                ('Tanggal Inspeksi', _fmt_date(insp.get('inspection_date'))),
                ('No Shipment', insp.get('shipment_number', '')),
                ('Status', insp.get('status', '')),
            ]
            _pdf_header(elements, company_name, 'Laporan Inspeksi Material (Vendor)', info_pairs=info_pairs)
            # Material items table
            if material_items:
                elements.append(Paragraph("<b>Material Items:</b>", styles['Heading3']))
                headers = ['No', 'Produk', 'SKU', 'Size', 'Warna', 'Qty Dikirim', 'Qty Diterima', 'Qty Missing', 'Catatan']
                data_rows = []
                for idx, item in enumerate(material_items, 1):
                    category = mat_categories.get(item.get('product_name', ''), '-')
                    data_rows.append([
                        idx, f"{item.get('product_name', '')}\n({category})",
                        item.get('sku', ''), item.get('size', ''), item.get('color', ''),
                        item.get('ordered_qty', 0), item.get('received_qty', 0),
                        item.get('missing_qty', 0), _safe_str(item.get('condition_notes', ''))
                    ])
                td = [headers] + data_rows
                total_row = ['', '', '', '', 'TOTAL',
                    sum(i.get('ordered_qty', 0) for i in material_items),
                    sum(i.get('received_qty', 0) for i in material_items),
                    sum(i.get('missing_qty', 0) for i in material_items), '']
                td.append(total_row)
                cw = [25, 90, 60, 40, 50, 55, 55, 55, 90]
                t = Table(td, colWidths=cw, repeatRows=1)
                t.setStyle(_pdf_table_style())
                t.setStyle(_pdf_total_row_style())
                elements.append(t)
            # Accessory items table
            if accessory_items:
                elements.append(Spacer(1, 6*mm))
                elements.append(Paragraph("<b>Aksesoris Items:</b>", styles['Heading3']))
                acc_headers = ['No', 'Aksesoris', 'Kode', 'Satuan', 'Qty Dikirim', 'Qty Diterima', 'Qty Missing', 'Catatan']
                acc_rows = []
                for idx, acc in enumerate(accessory_items, 1):
                    acc_rows.append([
                        idx, acc.get('accessory_name', ''), acc.get('accessory_code', ''),
                        acc.get('unit', 'pcs'), acc.get('ordered_qty', 0),
                        acc.get('received_qty', 0), acc.get('missing_qty', 0),
                        _safe_str(acc.get('condition_notes', ''))
                    ])
                acc_td = [acc_headers] + acc_rows
                acc_total = ['', '', '', 'TOTAL',
                    sum(a.get('ordered_qty', 0) for a in accessory_items),
                    sum(a.get('received_qty', 0) for a in accessory_items),
                    sum(a.get('missing_qty', 0) for a in accessory_items), '']
                acc_td.append(acc_total)
                acc_cw = [25, 100, 70, 45, 60, 60, 60, 90]
                at = Table(acc_td, colWidths=acc_cw, repeatRows=1)
                at.setStyle(_pdf_table_style())
                at.setStyle(_pdf_total_row_style())
                elements.append(at)
            if insp.get('overall_notes'):
                elements.append(Spacer(1, 4*mm))
                elements.append(Paragraph(f"<b>Catatan Umum:</b> {insp.get('overall_notes', '')}", styles['Normal']))
            # Signature
            elements.append(Spacer(1, 12*mm))
            sig_data = [['Inspektor', '', 'Pengirim (Vendor)'], ['', '', ''], ['_________________', '', '_________________']]
            st = Table(sig_data, colWidths=[180, 100, 180])
            st.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('FONTSIZE', (0, 0), (-1, -1), 9)]))
            elements.append(st)
            _pdf_footer(elements)
            _build_pdf(buf, elements, page='landscape')
            fname = f"Inspeksi-{insp.get('shipment_number', 'unknown')}.pdf"
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename={fname}"})

        # ──── BUYER SHIPMENT DISPATCH ────
        elif pdf_type == 'buyer-shipment-dispatch':
            shipment_id = sp.get('shipment_id')
            dispatch_seq = int(sp.get('dispatch_seq', 0))
            if not shipment_id or not dispatch_seq:
                raise HTTPException(400, 'shipment_id and dispatch_seq required')
            bs = await db.buyer_shipments.find_one({'id': shipment_id}, {'_id': 0})
            if not bs:
                raise HTTPException(404, 'Buyer shipment not found')
            items = await db.buyer_shipment_items.find({
                'shipment_id': shipment_id, 'dispatch_seq': dispatch_seq
            }, {'_id': 0}).to_list(500)
            if not items:
                raise HTTPException(404, f'No items for dispatch #{dispatch_seq}')
            all_items = await db.buyer_shipment_items.find({'shipment_id': shipment_id}).to_list(500)
            cumulative_by_poi = {}
            for ai in all_items:
                key = ai.get('po_item_id') or ai['id']
                if key not in cumulative_by_poi:
                    cumulative_by_poi[key] = {'ordered': ai.get('ordered_qty', 0), 'shipped': 0}
                if ai.get('dispatch_seq', 1) <= dispatch_seq:
                    cumulative_by_poi[key]['shipped'] += ai.get('qty_shipped', 0)
            elements = []
            _pdf_header(elements, company_name, f'Surat Jalan Buyer — Dispatch #{dispatch_seq}', info_pairs=[
                ('Shipment No', bs.get('shipment_number', '')), ('PO Number', bs.get('po_number', '')),
                ('Customer', bs.get('customer_name', '')), ('Vendor', bs.get('vendor_name', '')),
                ('Dispatch Date', _fmt_date(items[0].get('dispatch_date', ''))), ('Dispatch #', str(dispatch_seq)),
            ])
            all_col_keys = ['no', 'serial', 'product', 'sku', 'size', 'color', 'ordered', 'this_dispatch', 'cumul_shipped', 'remaining']
            headers = ['No', 'Serial', 'Product', 'SKU', 'Size', 'Color', 'Ordered', 'This Dispatch', 'Cumul. Shipped', 'Remaining']
            data_rows = []
            for idx, item in enumerate(items, 1):
                key = item.get('po_item_id') or item['id']
                cum = cumulative_by_poi.get(key, {'ordered': 0, 'shipped': 0})
                data_rows.append([
                    idx, _safe_str(item.get('serial_number')), _safe_str(item.get('product_name')),
                    _safe_str(item.get('sku')), _safe_str(item.get('size')), _safe_str(item.get('color')),
                    item.get('ordered_qty', 0), item.get('qty_shipped', 0), cum['shipped'],
                    max(0, cum['ordered'] - cum['shipped'])
                ])
            if config and config.get('columns'):
                headers, data_rows = _filter_columns(headers, all_col_keys, config['columns'], data_rows)
            td = [headers] + data_rows
            total_this = sum(i.get('qty_shipped', 0) for i in items)
            total_cum = sum(v['shipped'] for v in cumulative_by_poi.values())
            total_ord = sum(v['ordered'] for v in cumulative_by_poi.values())
            total_row = [''] * len(headers)
            if len(total_row) >= 4:
                total_row[-4] = total_ord
                total_row[-3] = total_this
                total_row[-2] = total_cum
                total_row[-1] = max(0, total_ord - total_cum)
                total_row[-5] = 'TOTAL' if len(total_row) > 5 else ''
            td.append(total_row)
            cw = [max(25, int(680 / len(headers)))] * len(headers)
            t = Table(td, colWidths=cw, repeatRows=1)
            t.setStyle(_pdf_table_style())
            t.setStyle(_pdf_total_row_style())
            t.setStyle(TableStyle([('ALIGN', (6, 0), (-1, -1), 'RIGHT')]))
            elements.append(t)
            _pdf_footer(elements)
            _build_pdf(buf, elements, page='landscape')
            fname = f"buyer_dispatch_{bs.get('shipment_number','')}_D{dispatch_seq}.pdf"
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename={fname}"})

        # ──── BUYER SHIPMENT (Cumulative Summary - all dispatches combined) ────
        elif pdf_type == 'buyer-shipment':
            sid = sp.get('id')
            if not sid:
                raise HTTPException(400, 'id required')
            bs = await db.buyer_shipments.find_one({'id': sid}, {'_id': 0})
            if not bs:
                raise HTTPException(404, 'Buyer shipment not found')
            all_items = await db.buyer_shipment_items.find({'shipment_id': sid}, {'_id': 0}).to_list(500)
            elements = []
            total_dispatches = max((i.get('dispatch_seq', 1) for i in all_items), default=0)
            _pdf_header(elements, company_name, 'Surat Jalan Buyer — Total Kumulatif', info_pairs=[
                ('Shipment No', bs.get('shipment_number', '')), ('PO Number', bs.get('po_number', '')),
                ('Customer', bs.get('customer_name', '')), ('Vendor', bs.get('vendor_name', '')),
                ('Status', bs.get('status', bs.get('ship_status', ''))),
                ('Total Dispatch', str(total_dispatches)),
            ])
            # Build cumulative summary per po_item (not per dispatch)
            poi_cumulative = {}
            for item in all_items:
                key = item.get('po_item_id') or f"{item.get('serial_number','')}|{item.get('sku','')}|{item.get('size','')}|{item.get('color','')}"
                if key not in poi_cumulative:
                    poi_cumulative[key] = {
                        'serial_number': item.get('serial_number', ''),
                        'product_name': item.get('product_name', ''),
                        'sku': item.get('sku', ''),
                        'size': item.get('size', ''),
                        'color': item.get('color', ''),
                        'ordered_qty': item.get('ordered_qty', 0),
                        'total_shipped': 0,
                    }
                poi_cumulative[key]['total_shipped'] += item.get('qty_shipped', 0)
            if not poi_cumulative:
                elements.append(Paragraph("No dispatch items found for this shipment.", styles['Normal']))
            else:
                td = [['No', 'Serial', 'Product', 'SKU', 'Size', 'Color', 'Ordered', 'Total Shipped', 'Remaining']]
                for idx, (key, cum) in enumerate(poi_cumulative.items(), 1):
                    remaining = max(0, cum['ordered_qty'] - cum['total_shipped'])
                    td.append([idx, _safe_str(cum['serial_number']), _safe_str(cum['product_name']),
                               _safe_str(cum['sku']), _safe_str(cum['size']), _safe_str(cum['color']),
                               cum['ordered_qty'], cum['total_shipped'], remaining])
                total_ordered = sum(v['ordered_qty'] for v in poi_cumulative.values())
                total_shipped = sum(v['total_shipped'] for v in poi_cumulative.values())
                total_remaining = max(0, total_ordered - total_shipped)
                total_row = ['', '', '', '', '', 'TOTAL', total_ordered, total_shipped, total_remaining]
                td.append(total_row)
                cw = [25, 60, 100, 70, 40, 50, 55, 70, 65]
                t = Table(td, colWidths=cw, repeatRows=1)
                t.setStyle(_pdf_table_style())
                t.setStyle(_pdf_total_row_style())
                t.setStyle(TableStyle([('ALIGN', (6, 0), (-1, -1), 'RIGHT')]))
                elements.append(t)
            _pdf_footer(elements)
            _build_pdf(buf, elements, page='landscape')
            fname = f"Buyer-Shipment-{bs.get('shipment_number', sid)}-Kumulatif.pdf"
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename={fname}"})

        # ──── PRODUCTION RETURN ────
        elif pdf_type == 'production-return':
            rid = sp.get('id')
            if not rid:
                raise HTTPException(400, 'id required')
            ret = await db.production_returns.find_one({'id': rid}, {'_id': 0})
            if not ret:
                raise HTTPException(404, 'Production return not found')
            items = await db.production_return_items.find({'return_id': rid}, {'_id': 0}).to_list(500)
            elements = []
            _pdf_header(elements, company_name, 'Surat Retur Produksi', info_pairs=[
                ('Return No', ret.get('return_number', '')), ('PO Number', ret.get('reference_po_number', '')),
                ('Customer', ret.get('customer_name', '')), ('Status', ret.get('status', '')),
                ('Return Date', _fmt_date(ret.get('return_date'))), ('Reason', _safe_str(ret.get('return_reason', ''), 60)),
            ])
            if items:
                td = [['No', 'Serial', 'Product', 'SKU', 'Size', 'Color', 'Qty Returned', 'Notes']]
                for idx, i in enumerate(items, 1):
                    td.append([idx, _safe_str(i.get('serial_number')), _safe_str(i.get('product_name')),
                               _safe_str(i.get('sku')), _safe_str(i.get('size')), _safe_str(i.get('color')),
                               i.get('return_qty', 0), _safe_str(i.get('notes', ''), 30)])
                total_row = ['', '', '', '', '', 'TOTAL', sum(i.get('return_qty', 0) for i in items), '']
                td.append(total_row)
                cw = [25, 60, 100, 70, 40, 50, 65, 80]
                t = Table(td, colWidths=cw, repeatRows=1)
                t.setStyle(_pdf_table_style())
                t.setStyle(_pdf_total_row_style())
                elements.append(t)
            else:
                elements.append(Paragraph("No return items found.", styles['Normal']))
            if ret.get('notes'):
                elements.append(Spacer(1, 4*mm))
                elements.append(Paragraph(f"<b>Notes:</b> {ret.get('notes', '')}", styles['Normal']))
            _pdf_footer(elements)
            _build_pdf(buf, elements)
            fname = f"Retur-{ret.get('return_number', rid)}.pdf"
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename={fname}"})

        # ──── MATERIAL REQUEST ────
        elif pdf_type == 'material-request':
            req_id = sp.get('id')
            if not req_id:
                raise HTTPException(400, 'id required')
            req = await db.material_requests.find_one({'id': req_id}, {'_id': 0})
            if not req:
                raise HTTPException(404, 'Material request not found')
            elements = []
            req_type = req.get('request_type', 'ADDITIONAL')
            _pdf_header(elements, company_name, f'Surat Permohonan Material ({req_type})', info_pairs=[
                ('Request No', req.get('request_number', '')), ('PO Number', req.get('po_number', '')),
                ('Vendor', req.get('vendor_name', '')), ('Status', req.get('status', '')),
                ('Total Qty', req.get('total_requested_qty', 0)),
                ('Child Shipment', req.get('child_shipment_number', '-')),
            ])
            # Request items if available
            req_items = req.get('items', [])
            if req_items:
                td = [['No', 'Serial', 'Product', 'SKU', 'Size', 'Color', 'Qty Requested']]
                for idx, i in enumerate(req_items, 1):
                    td.append([idx, _safe_str(i.get('serial_number')), _safe_str(i.get('product_name')),
                               _safe_str(i.get('sku')), _safe_str(i.get('size')), _safe_str(i.get('color')),
                               i.get('qty_requested', i.get('requested_qty', 0))])
                cw = [25, 65, 110, 75, 45, 55, 70]
                t = Table(td, colWidths=cw, repeatRows=1)
                t.setStyle(_pdf_table_style())
                elements.append(t)
            else:
                elements.append(Paragraph(f"Total Requested Quantity: <b>{req.get('total_requested_qty', 0)}</b>", styles['Normal']))
            if req.get('reason'):
                elements.append(Spacer(1, 4*mm))
                elements.append(Paragraph(f"<b>Reason:</b> {req.get('reason', '')}", styles['Normal']))
            # Approval signatures
            elements.append(Spacer(1, 15*mm))
            sig_data = [['Diajukan oleh:', '', 'Disetujui oleh:'], ['', '', ''], ['_________________', '', '_________________']]
            st = Table(sig_data, colWidths=[180, 100, 180])
            st.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('FONTSIZE', (0, 0), (-1, -1), 9)]))
            elements.append(st)
            _pdf_footer(elements)
            _build_pdf(buf, elements)
            fname = f"Permohonan-{req.get('request_number', req_id)}.pdf"
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename={fname}"})

        # ──── PRODUCTION REPORT (full) ────
        elif pdf_type == 'production-report':
            elements = []
            _pdf_header(elements, company_name, 'Laporan Produksi Lengkap')
            pos = await db.production_pos.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
            all_col_keys = ['no', 'date', 'po', 'serial', 'product', 'sku', 'size', 'color', 'qty', 'price', 'cmt', 'vendor', 'produced', 'shipped']
            headers = ['No', 'Date', 'PO', 'Serial', 'Product', 'SKU', 'Size', 'Color', 'Qty', 'Price', 'CMT', 'Vendor', 'Produced', 'Shipped']
            data_rows = []
            rn = 1
            for po in pos:
                items = await db.po_items.find({'po_id': po['id']}).to_list(500)
                for item in items:
                    ji = await db.production_job_items.find({'po_item_id': item['id']}).to_list(500)
                    produced = sum(j.get('produced_qty', 0) for j in ji)
                    bi = await db.buyer_shipment_items.find({'po_item_id': item['id']}).to_list(500)
                    shipped = sum(b.get('qty_shipped', 0) for b in bi)
                    data_rows.append([rn, _fmt_date(po.get('po_date')), _safe_str(po.get('po_number'), 15),
                        _safe_str(item.get('serial_number'), 15), _safe_str(item.get('product_name'), 20),
                        _safe_str(item.get('sku'), 15), _safe_str(item.get('size'), 8), _safe_str(item.get('color'), 10),
                        item.get('qty', 0), _fmt_money(item.get('selling_price_snapshot', 0)),
                        _fmt_money(item.get('cmt_price_snapshot', 0)),
                        _safe_str(po.get('vendor_name'), 15), produced, shipped])
                    rn += 1
            if config and config.get('columns'):
                headers, data_rows = _filter_columns(headers, all_col_keys, config['columns'], data_rows)
            if not data_rows:
                elements.append(Paragraph("No production data found.", styles['Normal']))
            else:
                td = [headers] + data_rows
                cw = [max(22, int(680 / len(headers)))] * len(headers)
                t = Table(td, colWidths=cw, repeatRows=1)
                t.setStyle(_pdf_table_style())
                t.setStyle(TableStyle([('FONTSIZE', (0, 0), (-1, -1), 7)]))
                elements.append(t)
            _pdf_footer(elements)
            _build_pdf(buf, elements, page='landscape')
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename=production_report_{datetime.now().strftime('%Y%m%d')}.pdf"})

        # ──── REPORT-* (Reuse /api/reports/{type} query logic) ────
        elif pdf_type.startswith('report-'):
            report_type = pdf_type[7:]  # strip 'report-' prefix
            valid_report_types = ['production', 'progress', 'financial', 'shipment', 'defect', 'return', 'missing-material', 'replacement', 'accessory']
            if report_type not in valid_report_types:
                return JSONResponse({'error': f'Unknown report type: {report_type}', 'available': valid_report_types}, status_code=400)

            # ── Get report data by reusing the same query logic as /api/reports/{type} ──
            report_data = []

            if report_type == 'production':
                po_query = {}
                if sp.get('status'):
                    po_query['status'] = sp['status']
                pos = await db.production_pos.find(po_query, {'_id': 0}).sort('created_at', -1).to_list(500)
                # Batch fetch all po_items (one query)
                po_ids = [po['id'] for po in pos]
                items_by_po = {}
                if po_ids:
                    async for it in db.po_items.find({'po_id': {'$in': po_ids}}):
                        items_by_po.setdefault(it['po_id'], []).append(it)
                for po in pos:
                    if sp.get('vendor_id') and po.get('vendor_id') != sp['vendor_id']:
                        continue
                    items = items_by_po.get(po['id'], [])
                    for item in items:
                        if sp.get('serial_number') and item.get('serial_number') != sp['serial_number']:
                            continue
                        report_data.append({
                            'tanggal': _fmt_date(po.get('po_date', po.get('created_at'))),
                            'no_po': po.get('po_number', ''), 'no_seri': item.get('serial_number', ''),
                            'nama_produk': item.get('product_name', ''), 'sku': item.get('sku', ''),
                            'size': item.get('size', ''), 'warna': item.get('color', ''),
                            'output_qty': item.get('qty', 0),
                            'harga': item.get('selling_price_snapshot', 0), 'hpp': item.get('cmt_price_snapshot', 0),
                            'garment': po.get('vendor_name', ''), 'po_status': po.get('status', ''),
                        })
                headers = ['No', 'Tanggal', 'No PO', 'Serial', 'Produk', 'SKU', 'Size', 'Warna', 'Qty', 'Harga', 'HPP/CMT', 'Vendor', 'Status']
                all_col_keys = ['no', 'tanggal', 'no_po', 'no_seri', 'nama_produk', 'sku', 'size', 'warna', 'output_qty', 'harga', 'hpp', 'garment', 'po_status']

            elif report_type == 'progress':
                progs = await db.production_progress.find({}, {'_id': 0}).sort('progress_date', -1).to_list(500)
                # Batch prefetch
                ji_ids = list({p.get('job_item_id') for p in progs if p.get('job_item_id')})
                job_ids = list({p.get('job_id') for p in progs if p.get('job_id')})
                ji_map = {}
                if ji_ids:
                    async for d in db.production_job_items.find({'id': {'$in': ji_ids}}):
                        ji_map[d['id']] = d
                jobs_map = {}
                if job_ids:
                    async for d in db.production_jobs.find({'id': {'$in': job_ids}}):
                        jobs_map[d['id']] = d
                for p in progs:
                    ji = ji_map.get(p.get('job_item_id'))
                    job = jobs_map.get(p.get('job_id'))
                    if sp.get('vendor_id') and (job or {}).get('vendor_id') != sp['vendor_id']:
                        continue
                    report_data.append({
                        'date': _fmt_date(p.get('progress_date')),
                        'job_number': (job or {}).get('job_number', ''),
                        'po_number': (job or {}).get('po_number', ''),
                        'vendor_name': (job or {}).get('vendor_name', ''),
                        'serial_number': (ji or {}).get('serial_number', ''),
                        'sku': (ji or {}).get('sku', p.get('sku', '')),
                        'product_name': (ji or {}).get('product_name', p.get('product_name', '')),
                        'qty_progress': p.get('completed_quantity', 0),
                        'notes': p.get('notes', ''), 'recorded_by': p.get('recorded_by', '')
                    })
                headers = ['No', 'Tanggal', 'Job', 'PO', 'Vendor', 'Serial', 'SKU', 'Produk', 'Qty', 'Catatan', 'Dicatat oleh']
                all_col_keys = ['no', 'date', 'job_number', 'po_number', 'vendor_name', 'serial_number', 'sku', 'product_name', 'qty_progress', 'notes', 'recorded_by']

            elif report_type == 'financial':
                # FORENSIC_12 GAP-01: legacy `invoices` dropped. Read from SSOT.
                inv_query = {}
                if sp.get('status'):
                    inv_query['status'] = sp['status']
                ar_invs = await db.rahaza_ar_invoices.find(inv_query, {'_id': 0}).sort('created_at', -1).to_list(500)
                ap_invs = await db.rahaza_ap_invoices.find(inv_query, {'_id': 0}).sort('created_at', -1).to_list(500)
                invoices = ar_invs + ap_invs
                for inv in invoices:
                    report_data.append({
                        'invoice_number': inv.get('invoice_number', ''),
                        'category': inv.get('invoice_category', inv.get('type', '')),
                        'po_number': inv.get('po_number', inv.get('order_number', '')),
                        'vendor_or_buyer': inv.get('vendor_name', inv.get('customer_name', '')),
                        'amount': inv.get('total_amount', inv.get('total', inv.get('amount', 0))),
                        'paid': inv.get('total_paid', inv.get('paid_amount', 0)),
                        'remaining': inv.get('remaining_balance', 0),
                        'status': inv.get('status', ''),
                        'date': _fmt_date(inv.get('invoice_date', inv.get('created_at'))),
                    })
                headers = ['No', 'Invoice No', 'Category', 'PO', 'Vendor/Buyer', 'Amount', 'Paid', 'Remaining', 'Status', 'Date']
                all_col_keys = ['no', 'invoice_number', 'category', 'po_number', 'vendor_or_buyer', 'amount', 'paid', 'remaining', 'status', 'date']

            elif report_type == 'shipment':
                vs = await db.vendor_shipments.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
                bsh = await db.buyer_shipments.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
                for v in vs:
                    if sp.get('vendor_id') and v.get('vendor_id') != sp['vendor_id']:
                        continue
                    items = await db.vendor_shipment_items.find({'shipment_id': v['id']}).to_list(500)
                    report_data.append({
                        'direction': 'VENDOR', 'shipment_number': v.get('shipment_number', ''),
                        'shipment_type': v.get('shipment_type', 'NORMAL'), 'vendor_name': v.get('vendor_name', ''),
                        'status': v.get('status', ''), 'inspection': v.get('inspection_status', 'Pending'),
                        'date': _fmt_date(v.get('shipment_date', v.get('created_at'))),
                        'total_qty': sum(i.get('qty_sent', 0) for i in items), 'items': len(items)
                    })
                for b in bsh:
                    if sp.get('vendor_id') and b.get('vendor_id') != sp['vendor_id']:
                        continue
                    items = await db.buyer_shipment_items.find({'shipment_id': b['id']}).to_list(500)
                    report_data.append({
                        'direction': 'BUYER', 'shipment_number': b.get('shipment_number', ''),
                        'shipment_type': 'NORMAL', 'vendor_name': b.get('vendor_name', ''),
                        'status': b.get('status', b.get('ship_status', '')), 'inspection': '-',
                        'date': _fmt_date(b.get('created_at')),
                        'total_qty': sum(i.get('qty_shipped', 0) for i in items), 'items': len(items)
                    })
                headers = ['No', 'Direction', 'Shipment No', 'Type', 'Vendor', 'Status', 'Inspection', 'Date', 'Qty', 'Items']
                all_col_keys = ['no', 'direction', 'shipment_number', 'shipment_type', 'vendor_name', 'status', 'inspection', 'date', 'total_qty', 'items']

            elif report_type == 'defect':
                defects = await db.material_defect_reports.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
                for d in defects:
                    if sp.get('vendor_id') and d.get('vendor_id') != sp['vendor_id']:
                        continue
                    report_data.append({
                        'date': _fmt_date(d.get('report_date', d.get('created_at'))),
                        'sku': d.get('sku', ''), 'product_name': d.get('product_name', ''),
                        'size': d.get('size', ''), 'color': d.get('color', ''),
                        'defect_qty': d.get('defect_qty', 0), 'defect_type': d.get('defect_type', ''),
                        'description': d.get('description', ''), 'status': d.get('status', '')
                    })
                headers = ['No', 'Tanggal', 'SKU', 'Produk', 'Size', 'Warna', 'Qty Defect', 'Tipe', 'Deskripsi', 'Status']
                all_col_keys = ['no', 'date', 'sku', 'product_name', 'size', 'color', 'defect_qty', 'defect_type', 'description', 'status']

            elif report_type == 'return':
                returns = await db.production_returns.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
                for r in returns:
                    items = await db.production_return_items.find({'return_id': r['id']}).to_list(500)
                    report_data.append({
                        'return_number': r.get('return_number', ''), 'po_number': r.get('reference_po_number', ''),
                        'customer_name': r.get('customer_name', ''), 'return_date': _fmt_date(r.get('return_date')),
                        'total_qty': sum(i.get('return_qty', 0) for i in items), 'item_count': len(items),
                        'reason': r.get('return_reason', ''), 'status': r.get('status', ''),
                    })
                headers = ['No', 'Return No', 'PO', 'Customer', 'Date', 'Total Qty', 'Items', 'Reason', 'Status']
                all_col_keys = ['no', 'return_number', 'po_number', 'customer_name', 'return_date', 'total_qty', 'item_count', 'reason', 'status']

            elif report_type == 'missing-material':
                reqs = await db.material_requests.find({'request_type': 'ADDITIONAL'}, {'_id': 0}).sort('created_at', -1).to_list(500)
                for r in reqs:
                    if sp.get('vendor_id') and r.get('vendor_id') != sp['vendor_id']:
                        continue
                    report_data.append({
                        'request_number': r.get('request_number', ''), 'vendor_name': r.get('vendor_name', ''),
                        'po_number': r.get('po_number', ''), 'total_qty': r.get('total_requested_qty', 0),
                        'reason': r.get('reason', ''), 'status': r.get('status', ''),
                        'child_shipment': r.get('child_shipment_number', '-'),
                        'date': _fmt_date(r.get('created_at')),
                    })
                headers = ['No', 'Request No', 'Vendor', 'PO', 'Qty', 'Reason', 'Status', 'Child Shipment', 'Date']
                all_col_keys = ['no', 'request_number', 'vendor_name', 'po_number', 'total_qty', 'reason', 'status', 'child_shipment', 'date']

            elif report_type == 'replacement':
                reqs = await db.material_requests.find({'request_type': 'REPLACEMENT'}, {'_id': 0}).sort('created_at', -1).to_list(500)
                for r in reqs:
                    if sp.get('vendor_id') and r.get('vendor_id') != sp['vendor_id']:
                        continue
                    report_data.append({
                        'request_number': r.get('request_number', ''), 'vendor_name': r.get('vendor_name', ''),
                        'po_number': r.get('po_number', ''), 'total_qty': r.get('total_requested_qty', 0),
                        'reason': r.get('reason', ''), 'status': r.get('status', ''),
                        'child_shipment': r.get('child_shipment_number', '-'),
                        'date': _fmt_date(r.get('created_at')),
                    })
                headers = ['No', 'Request No', 'Vendor', 'PO', 'Qty', 'Reason', 'Status', 'Child Shipment', 'Date']
                all_col_keys = ['no', 'request_number', 'vendor_name', 'po_number', 'total_qty', 'reason', 'status', 'child_shipment', 'date']

            elif report_type == 'accessory':
                acc_ships = await db.accessory_shipments.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
                for s in acc_ships:
                    if sp.get('vendor_id') and s.get('vendor_id') != sp['vendor_id']:
                        continue
                    items = await db.accessory_shipment_items.find({'shipment_id': s['id']}).to_list(500)
                    for item in items:
                        report_data.append({
                            'shipment_number': s.get('shipment_number', ''), 'vendor_name': s.get('vendor_name', ''),
                            'po_number': s.get('po_number', ''), 'date': _fmt_date(s.get('shipment_date')),
                            'accessory_name': item.get('accessory_name', ''), 'accessory_code': item.get('accessory_code', ''),
                            'qty_sent': item.get('qty_sent', 0), 'unit': item.get('unit', 'pcs'),
                            'status': s.get('status', ''),
                        })
                headers = ['No', 'Shipment', 'Vendor', 'PO', 'Date', 'Accessory', 'Code', 'Qty', 'Unit', 'Status']
                all_col_keys = ['no', 'shipment_number', 'vendor_name', 'po_number', 'date', 'accessory_name', 'accessory_code', 'qty_sent', 'unit', 'status']
            else:
                return JSONResponse({'error': f'Unhandled report type: {report_type}'}, status_code=400)

            # Build the report PDF
            report_labels = {
                'production': 'Laporan Produksi', 'progress': 'Laporan Progres Produksi',
                'financial': 'Laporan Keuangan', 'shipment': 'Laporan Pengiriman',
                'defect': 'Laporan Defect Material', 'return': 'Laporan Retur Produksi',
                'missing-material': 'Laporan Material Hilang/Tambahan', 'replacement': 'Laporan Material Pengganti',
                'accessory': 'Laporan Aksesoris',
            }
            elements = []
            title = report_labels.get(report_type, f'Report: {report_type}')
            filter_info = []
            if sp.get('vendor_id'):
                vendor = await db.garments.find_one({'id': sp['vendor_id']})
                filter_info.append(('Vendor', (vendor or {}).get('garment_name', sp['vendor_id'])))
            if sp.get('date_from'):
                filter_info.append(('From', sp['date_from']))
            if sp.get('date_to'):
                filter_info.append(('To', sp['date_to']))
            if sp.get('status'):
                filter_info.append(('Status', sp['status']))
            _pdf_header(elements, company_name, title, info_pairs=filter_info if filter_info else None)

            if not report_data:
                elements.append(Paragraph("Tidak ada data ditemukan untuk filter yang dipilih.", styles['Normal']))
            else:
                # Build table data
                data_rows = []
                for idx, row in enumerate(report_data, 1):
                    row_values = [idx]
                    for key in all_col_keys[1:]:  # skip 'no'
                        val = row.get(key, '')
                        if key in ('harga', 'hpp', 'amount', 'paid', 'remaining'):
                            val = _fmt_money(val)
                        elif key in ('output_qty', 'qty_progress', 'defect_qty', 'total_qty', 'item_count', 'items', 'qty_sent'):
                            val = val if val else 0
                        else:
                            val = _safe_str(val, 25)
                        row_values.append(val)
                    data_rows.append(row_values)
                if config and config.get('columns'):
                    headers, data_rows = _filter_columns(headers, all_col_keys, config['columns'], data_rows)
                td = [headers] + data_rows
                num_cols = len(headers)
                use_landscape = num_cols > 7
                page_width = 680 if use_landscape else 445
                cw = [max(22, int(page_width / num_cols))] * num_cols
                t = Table(td, colWidths=cw, repeatRows=1)
                t.setStyle(_pdf_table_style())
                t.setStyle(TableStyle([('FONTSIZE', (0, 0), (-1, -1), 7 if num_cols > 8 else 8)]))
                elements.append(t)

            elements.append(Spacer(1, 4*mm))
            elements.append(Paragraph(f"<i>Total Records: {len(report_data)}</i>", styles['Normal']))
            _pdf_footer(elements)
            _build_pdf(buf, elements, page='landscape' if len(headers) > 7 else None)
            return StreamingResponse(buf, media_type="application/pdf",
                                     headers={"Content-Disposition": f"attachment; filename=laporan_{report_type}_{datetime.now().strftime('%Y%m%d')}.pdf"})

        else:
            all_types = [
                'production-po', 'vendor-shipment', 'buyer-shipment', 'buyer-shipment-dispatch',
                'production-return', 'material-request', 'production-report',
                'report-production', 'report-progress', 'report-financial', 'report-shipment',
                'report-defect', 'report-return', 'report-missing-material', 'report-replacement', 'report-accessory'
            ]
            return JSONResponse({'error': f'Unknown PDF type: {pdf_type}', 'available_types': all_types}, status_code=400)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF export error: {e}", exc_info=True)
        raise HTTPException(500, f"PDF export failed: {str(e)}")


# ─── PDF EXPORT CONFIGURATION CRUD ───────────────────────────────────────────

# Available columns per PDF type (used by config UI)
