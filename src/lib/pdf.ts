import { PDFDocument, StandardFonts, PageSizes, rgb } from 'pdf-lib';

export type ExportRow = {
  date: string; // ISO string or formatted
  description: string;
  reference?: string;
  amount: number; // neu: Transaktionsbetrag
  balanceAfter: number; // numeric value in EUR
  other?: string; // Gegenkonto label
  costCenter?: string; // BudgetPlan - CostCenter
};

export async function generateTransactionsPdf(title: string, rows: ExportRow[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const [pw, ph] = PageSizes.A4; // portrait width/height
  const pageSize: [number, number] = [ph, pw]; // landscape
  const margin = 40;

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Basiskonfiguration der Spalten: baseWidth + minWidth; wird auf verfügbare Breite skaliert
  const baseColumns = [
    { key: 'date', label: 'Datum', base: 100, min: 70 },
    { key: 'description', label: 'Beschreibung', base: 300, min: 180 },
    { key: 'reference', label: 'Referenz', base: 150, min: 120 },
    { key: 'amount', label: 'Betrag', base: 110, min: 60 }, // neu
    { key: 'balanceAfter', label: 'Kontostand danach', base: 150, min: 60 },
    { key: 'other', label: 'Gegenkonto', base: 210, min: 120 },
    { key: 'costCenter', label: 'Kostenstelle', base: 200, min: 120 },
  ] as const;

  const bodyFontSize = 10;
  const lineHeight = 12; // px between wrapped lines
  const cellPaddingX = 2; // small left padding inside cells
  const rowGap = 2; // space between rows
  const headerFontSize = 11;
  const headerLineHeight = 13;

  let page = pdfDoc.addPage(pageSize);
  let y = page.getHeight() - margin;

  // verfügbare Breite berechnen und Spaltenbreiten anpassen
  const usableWidth = page.getWidth() - 2 * margin;
  function computeColumnWidths() {
    const sumBase = baseColumns.reduce((s, c) => s + c.base, 0);
    let factor = Math.min(1, usableWidth / sumBase);
    const widths = baseColumns.map((c) => Math.max(c.min, Math.floor(c.base * factor)));
    let sum = widths.reduce((s, w) => s + w, 0);
    // Wenn immer noch größer als verfügbar (Min-Summen > usableWidth), versuche gleichmäßiges Kürzen > min
    if (sum > usableWidth) {
      let overflow = sum - usableWidth;
      // iterative Reduktion: verteile 1pt Abschläge auf Spalten, die über min liegen
      let safeGuard = 2000;
      while (overflow > 0 && safeGuard-- > 0) {
        let reduced = false;
        for (let i = 0; i < widths.length && overflow > 0; i++) {
          const min = baseColumns[i].min;
          if (widths[i] > min) {
            widths[i] -= 1;
            overflow -= 1;
            reduced = true;
          }
        }
        if (!reduced) break; // nichts mehr reduzierbar
      }
    }
    return widths;
  }
  const widths = computeColumnWidths();
  const columns = baseColumns.map((c, i) => ({ key: c.key, label: c.label, width: widths[i] }));

  // Title (einmalig)
  page.setFont(boldFont);
  page.setFontSize(16);
  page.drawText(title, { x: margin, y });
  y -= 18;
  page.setFont(normalFont);
  page.setFontSize(10);
  const createdAt = new Date().toLocaleString('de-DE');
  page.drawText(`Erstellt am ${createdAt}`, { x: margin, y, color: rgb(0.4, 0.4, 0.4) });
  y -= 24;

  function wrapTextWith(font: any, fontSize: number, text: string, maxWidth: number): string[] {
    const t = (text || '').toString();
    if (!t) return [''];
    const words = t.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    const measure = (s: string) => font.widthOfTextAtSize(s, fontSize);

    for (let w of words) {
      if (measure(w) > maxWidth) {
        // sehr langes "Wort" hart umbrechen
        while (w.length > 0) {
          let lo = 1, hi = w.length, fit = 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const part = w.slice(0, mid);
            if (measure(part) <= maxWidth) {
              fit = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          const chunk = w.slice(0, fit);
          w = w.slice(fit);
          if (current) {
            lines.push(current.trim());
            current = '';
          }
          lines.push(chunk);
        }
        continue;
      }
      const candidate = current ? `${current} ${w}` : w;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current.trim());
        current = w;
      }
    }
    if (current) lines.push(current.trim());
    return lines.length > 0 ? lines : [''];
  }

  function drawHeader() {
    page.setFont(boldFont);
    page.setFontSize(headerFontSize);

    // Header-Zeilen pro Spalte wrapen und maximale Höhe bestimmen
    const headerLinesPerCol: string[][] = [];
    let maxHeaderLines = 1;
    for (const c of columns) {
      const lines = wrapTextWith(boldFont, headerFontSize, c.label, c.width - cellPaddingX * 2);
      headerLinesPerCol.push(lines);
      if (lines.length > maxHeaderLines) maxHeaderLines = lines.length;
    }

    // Header zeichnen (jede Spalte mit eigenem yLocal)
    let x = margin;
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const lines = headerLinesPerCol[i];
      let yLocal = y; // lokale Ausgangsposition je Spalte
      for (let li = 0; li < lines.length; li++) {
        page.drawText(lines[li], { x: x + cellPaddingX, y: yLocal });
        yLocal -= headerLineHeight;
      }
      x += c.width;
    }

    // Globale y-Position nach dem höchsten Headerblock anpassen
    y -= maxHeaderLines * headerLineHeight;

    // Linie unter Header über gesamte Tabellenbreite
    const totalWidth = columns.reduce((s, c) => s + c.width, 0);
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + totalWidth, y: y - 4 }, color: rgb(0.8, 0.8, 0.8), thickness: 1 });

    // Nach Headerabstand
    y -= lineHeight;
    page.setFont(normalFont);
    page.setFontSize(bodyFontSize);
  }

  function ensureSpace(requiredHeight: number) {
    if (y - requiredHeight < margin) {
      page = pdfDoc.addPage(pageSize);
      y = page.getHeight() - margin;
      drawHeader();
    }
  }

  function wrapText(text: string, maxWidth: number): string[] {
    const t = (text || '').toString();
    if (!t) return [''];
    const words = t.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    const measure = (s: string) => normalFont.widthOfTextAtSize(s, bodyFontSize);

    for (let w of words) {
      if (measure(w) > maxWidth) {
        // sehr langes "Wort" hart umbrechen
        while (w.length > 0) {
          let lo = 1, hi = w.length, fit = 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const part = w.slice(0, mid);
            if (measure(part) <= maxWidth) {
              fit = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          const chunk = w.slice(0, fit);
          w = w.slice(fit);
          if (current) {
            lines.push(current.trim());
            current = '';
          }
          lines.push(chunk);
        }
        continue;
      }
      const candidate = current ? `${current} ${w}` : w;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current.trim());
        current = w;
      }
    }
    if (current) lines.push(current.trim());
    return lines.length > 0 ? lines : [''];
  }

  // Header nur einmal zeichnen
  drawHeader();

  for (const r of rows) {
    // Werte vorbereiten
    const vals: Record<string, string> = {
      date: formatDate(r.date),
      description: r.description || '',
      reference: r.reference || '',
      amount: formatCurrency(r.amount),
      balanceAfter: formatCurrency(r.balanceAfter),
      other: r.other || '',
      costCenter: r.costCenter || '',
    };

    // Wrap pro Spalte vorberechnen und max. benötigte Zeilenhöhe ermitteln
    const wrapped: Record<string, string[]> = {};
    let maxLines = 1;
    for (const c of columns) {
      const lines = wrapText(vals[c.key] ?? '', c.width - cellPaddingX * 2);
      wrapped[c.key] = lines;
      if (lines.length > maxLines) maxLines = lines.length;
    }
    const requiredHeight = maxLines * lineHeight + rowGap;
    ensureSpace(requiredHeight);

    // Zeile zeichnen
    let x = margin;
    for (const c of columns) {
      const lines = wrapped[c.key];
      for (let i = 0; i < lines.length; i++) {
        page.drawText(lines[i], { x: x + cellPaddingX, y: y - i * lineHeight });
      }
      x += c.width;
    }
    y -= requiredHeight;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString('de-DE');
  } catch {
    return s;
  }
}

function formatCurrency(n: number): string {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
  } catch {
    return `${n.toFixed(2)} €`;
  }
}
