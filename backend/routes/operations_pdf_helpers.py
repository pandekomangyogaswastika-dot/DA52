# ruff: noqa: F401
"""
operations_pdf_helpers.py — PDF Generation Helper Functions
Utilities for PDF styling, table generation, and config management

Refactored: Session #11.19 Phase 3.2.6 (split from operations_pdf.py 900 LOC)
Used by: operations_pdf.py (main PDF export endpoint)
"""
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


# ─── PDF Styling Helpers ─────────────────────────────────────────────────────
def _pdf_styles():
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='SmallCell', fontSize=7, leading=9, wordWrap='LTR'))
    styles.add(ParagraphStyle(name='SmallCellBold', fontSize=7, leading=9, fontName='Helvetica-Bold', wordWrap='LTR'))
    return styles


def _pdf_table_style():
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle
    return TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#334155')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ])


def _pdf_total_row_style():
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle
    return TableStyle([
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f1f5f9')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ])


def _build_pdf(buf, elements, page=None):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate
    ps = landscape(A4) if page == 'landscape' else A4
    doc = SimpleDocTemplate(buf, pagesize=ps, leftMargin=12*mm, rightMargin=12*mm, topMargin=12*mm, bottomMargin=12*mm)
    doc.build(elements)
    buf.seek(0)
    return buf


def _pdf_header(elements, company_name, title, subtitle=None, info_pairs=None):
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.units import mm
    styles = _pdf_styles()
    elements.append(Paragraph(f"<b>{company_name}</b>", styles['Title']))
    elements.append(Paragraph(title, styles['Heading2']))
    if subtitle:
        elements.append(Paragraph(subtitle, styles['Normal']))
    elements.append(Spacer(1, 4*mm))
    if info_pairs:
        info_data = []
        row = []
        for i, (k, v) in enumerate(info_pairs):
            row.extend([f"{k}:", str(v or '-')])
            if len(row) >= 4 or i == len(info_pairs) - 1:
                while len(row) < 4:
                    row.append('')
                info_data.append(row)
                row = []
        if info_data:
            it = Table(info_data, colWidths=[85, 180, 85, 180])
            it.setStyle(TableStyle([('FONTSIZE', (0, 0), (-1, -1), 9), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                                    ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'), ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold')]))
            elements.append(it)
            elements.append(Spacer(1, 5*mm))
    return elements


def _pdf_footer(elements):
    from reportlab.platypus import Paragraph, Spacer
    from reportlab.lib.units import mm
    styles = _pdf_styles()
    elements.append(Spacer(1, 8*mm))
    elements.append(Paragraph(f"<i>Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}</i>", styles['Normal']))
    return elements


def _safe_str(v, max_len=40):
    s = str(v or '')
    return s[:max_len] if len(s) > max_len else s


async def enrich_with_product_photos(items, db):
    """Add product photo_url to items that have a product_name. Single batch query."""
    if not items:
        return items
    pnames = list({(it.get('product_name') or '').strip() for it in items if it.get('product_name')})
    photos = {}
    if pnames:
        prods = await db.products.find(
            {'product_name': {'$in': pnames}}, {'_id': 0, 'product_name': 1, 'photo_url': 1}
        ).to_list(500)
        photos = {p['product_name']: p.get('photo_url', '') for p in prods}
    for item in items:
        if item.get('product_name'):
            item['product_photo'] = photos.get(item['product_name'], '')
    return items


# ─── PDF Export Config Helpers ───────────────────────────────────────────────
async def _get_pdf_config(db, pdf_type, config_id=None):
    """Get PDF export config (custom columns) if exists."""
    if config_id:
        cfg = await db.pdf_export_configs.find_one({'id': config_id})
        if cfg:
            return cfg
    # Try default for this type
    cfg = await db.pdf_export_configs.find_one({'pdf_type': pdf_type, 'is_default': True})
    return cfg


def _filter_columns(headers, all_col_keys, selected_keys, data_rows):
    """Filter table columns based on selected keys from config."""
    if not selected_keys:
        return headers, data_rows
    indices = [i for i, k in enumerate(all_col_keys) if k in selected_keys]
    if not indices:
        return headers, data_rows
    new_headers = [headers[i] for i in indices]
    new_rows = [[row[i] if i < len(row) else '' for i in indices] for row in data_rows]
    return new_headers, new_rows
