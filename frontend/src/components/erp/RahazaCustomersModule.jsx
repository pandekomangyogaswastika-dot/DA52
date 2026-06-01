import MasterDataCRUD from './MasterDataCRUD';

const PAYMENT_TERMS = [
  { value: 'cash',    label: 'Cash / Tunai' },
  { value: 'net_7',   label: 'Net 7 hari' },
  { value: 'net_14',  label: 'Net 14 hari' },
  { value: 'net_30',  label: 'Net 30 hari' },
  { value: 'custom',  label: 'Custom (isi di kolom catatan)' },
];

export default function RahazaCustomersModule({ token }) {
  return (
    <MasterDataCRUD
      title="Pelanggan"
      description="Master pelanggan produk rajut — termasuk informasi NPWP dan terms pembayaran untuk keperluan Finance."
      endpoint="/api/rahaza/customers"
      token={token}
      testIdPrefix="rahaza-customer"
      columns={[
        { key: 'code', label: 'Kode' },
        { key: 'name', label: 'Nama' },
        { key: 'company_type', label: 'Tipe', render: v => v === 'personal' ? 'Perorangan' : 'Perusahaan' },
        { key: 'npwp', label: 'NPWP', render: v => v || '-' },
        { key: 'phone', label: 'Telepon', render: v => v || '-' },
        { key: 'payment_terms', label: 'Term Bayar',
          render: v => (PAYMENT_TERMS.find(p => p.value === v)?.label) || v },
        { key: 'credit_limit', label: 'Limit Kredit',
          render: v => v ? `Rp ${Number(v).toLocaleString('id-ID')}` : '-' },
      ]}
      fields={[
        { key: 'code', label: 'Kode Pelanggan', required: true, placeholder: 'Contoh: CUST-001' },
        { key: 'name', label: 'Nama Pelanggan / Perusahaan', required: true },
        { key: 'company_type', label: 'Tipe Pelanggan', type: 'select',
          options: [
            { value: 'company', label: 'Perusahaan' },
            { value: 'personal', label: 'Perorangan' },
          ] },
        { key: 'npwp', label: 'NPWP', placeholder: 'Opsional' },
        { key: 'phone', label: 'Telepon' },
        { key: 'email', label: 'Email' },
        { key: 'address', label: 'Alamat' },
        { key: 'payment_terms', label: 'Term Pembayaran', type: 'select', options: PAYMENT_TERMS },
        { key: 'payment_terms_custom', label: 'Detail Term Custom', placeholder: 'Isi jika term = Custom' },
        { key: 'credit_limit', label: 'Limit Kredit (Rp)', type: 'number' },
        { key: 'notes', label: 'Catatan' },
      ]}
      defaultItem={{
        code: '', name: '', company_type: 'company', npwp: '', phone: '', email: '',
        address: '', payment_terms: 'net_30', payment_terms_custom: '', credit_limit: 0, notes: '',
      }}
    />
  );
}
