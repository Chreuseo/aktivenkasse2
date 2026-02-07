import { generateDonationReceiptPdf } from './pdf';

async function main() {
  const buf = await generateDonationReceiptPdf({
    corporation: 'Test Corp',
    address: 'Teststraße 1, 12345 Teststadt',
    donationHeader: 'Spendenquittung',
    donationEntry: 'Hiermit bestätigen wir ...',
    donationFooter: 'Footer',
    signatory1Role: '1. Vorsitzender',
    signatory1Name: 'Max Mustermann',
    signatory2Role: 'Kassenwart',
    signatory2Name: 'Erika Mustermann',
    signatureFooter: 'Maschinell erstellt',
    user: { name: 'Hans Beispiel', street: 'Musterweg 2', postalCode: '11111', city: 'Beispielstadt' },
    createdAt: new Date('2026-02-06T10:00:00.000Z'),
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-01-31T00:00:00.000Z'),
    rows: [],
  });

  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf.subarray(0, 4).toString('utf8') !== '%PDF') {
    throw new Error('PDF Smoke-Test fehlgeschlagen');
  }
}

main();
