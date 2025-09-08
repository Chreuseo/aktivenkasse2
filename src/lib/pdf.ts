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

// --------- Budget-Plan Export ---------
export type BudgetPlanSummaryRow = {
  name: string;
  expectedCosts: number;
  actualCosts: number;
  expectedEarnings: number;
  actualEarnings: number;
  expectedResult: number; // expectedEarnings - expectedCosts
  actualResult: number;   // actualEarnings - actualCosts
};

export type BudgetPlanTxRow = { date: string; description: string; amount: number; other?: string };

export type BudgetPlanExportData = {
  planName: string;
  variant: 'simpel' | 'anonym' | 'voll';
  summaries: BudgetPlanSummaryRow[]; // in gewünschter Reihenfolge
  details?: { name: string; txs: BudgetPlanTxRow[] }[]; // Reihenfolge kompatibel zu summaries
};

export async function generateBudgetPlanPdf(title: string, data: BudgetPlanExportData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const [pw, ph] = PageSizes.A4; // portrait width/height
  const pageSize: [number, number] = [ph, pw]; // landscape
  const margin = 40;

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let page = pdfDoc.addPage(pageSize);
  let y = page.getHeight() - margin;

  // Header
  page.setFont(boldFont);
  page.setFontSize(16);
  page.drawText(title, { x: margin, y });
  y -= 18;
  page.setFont(normalFont);
  page.setFontSize(10);
  const createdAt = new Date().toLocaleString('de-DE');
  page.drawText(`Erstellt am ${createdAt}`, { x: margin, y, color: rgb(0.4, 0.4, 0.4) });
  y -= 24;

  // Summary-Tabelle zeichnen
  const bodyFontSize = 10;
  const headerFontSize = 11;
  const lineHeight = 12;
  const headerLineHeight = 13;
  const cellPaddingX = 2;
  const rowGap = 2;

  const summaryColumns = [
    { key: 'name', label: 'Kostenstelle', base: 300, min: 160 },
    { key: 'expectedCosts', label: 'Erwartete Ausgaben', base: 140, min: 100 },
    { key: 'actualCosts', label: 'Tatsächliche Ausgaben', base: 140, min: 100 },
    { key: 'expectedEarnings', label: 'Erwartete Einnahmen', base: 150, min: 110 },
    { key: 'actualEarnings', label: 'Tatsächliche Einnahmen', base: 150, min: 110 },
    { key: 'expectedResult', label: 'Erwartetes Ergebnis', base: 150, min: 110 },
    { key: 'actualResult', label: 'Tatsächliches Ergebnis', base: 150, min: 110 },
  ] as const;

  function computeWidths(baseCols: readonly { base: number; min: number }[]) {
    const usableWidth = page.getWidth() - 2 * margin;
    const sumBase = baseCols.reduce((s, c) => s + c.base, 0);
    let factor = Math.min(1, usableWidth / sumBase);
    const widths = baseCols.map((c) => Math.max(c.min, Math.floor(c.base * factor)));
    let sum = widths.reduce((s, w) => s + w, 0);
    if (sum > usableWidth) {
      let overflow = sum - usableWidth;
      let safe = 2000;
      while (overflow > 0 && safe-- > 0) {
        let reduced = false;
        for (let i = 0; i < widths.length && overflow > 0; i++) {
          if (widths[i] > baseCols[i].min) {
            widths[i] -= 1; overflow -= 1; reduced = true;
          }
        }
        if (!reduced) break;
      }
    }
    return widths;
  }

  function wrap(font: any, fs: number, text: string, maxWidth: number) {
    const t = (text || '').toString();
    if (!t) return [''];
    const measure = (s: string) => font.widthOfTextAtSize(s, fs);
    const words = t.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (let w of words) {
      if (measure(w) > maxWidth) {
        while (w.length > 0) {
          let lo = 1, hi = w.length, fit = 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const part = w.slice(0, mid);
            if (measure(part) <= maxWidth) { fit = mid; lo = mid + 1; } else { hi = mid - 1; }
          }
          const chunk = w.slice(0, fit);
          w = w.slice(fit);
          if (current) { lines.push(current.trim()); current = ''; }
          lines.push(chunk);
        }
        continue;
      }
      const candidate = current ? `${current} ${w}` : w;
      if (measure(candidate) <= maxWidth) current = candidate; else { if (current) lines.push(current.trim()); current = w; }
    }
    if (current) lines.push(current.trim());
    return lines.length > 0 ? lines : [''];
  }

  function ensureSpace(requiredHeight: number, drawHeaderFn?: () => void) {
    if (y - requiredHeight < margin) {
      page = pdfDoc.addPage(pageSize);
      y = page.getHeight() - margin;
      if (drawHeaderFn) drawHeaderFn();
    }
  }

  function drawSummaryTable() {
    const widths = computeWidths(summaryColumns);
    const columns = summaryColumns.map((c, i) => ({ ...c, width: widths[i] }));

    // Header
    page.setFont(boldFont); page.setFontSize(headerFontSize);
    let maxHeaderLines = 1; const headerLinesPerCol: string[][] = [];
    for (const c of columns) {
      const lines = wrap(boldFont, headerFontSize, c.label, c.width - cellPaddingX * 2);
      headerLinesPerCol.push(lines); if (lines.length > maxHeaderLines) maxHeaderLines = lines.length;
    }
    let x = margin; const headerStartY = y;
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i]; const lines = headerLinesPerCol[i]; let yLocal = y;
      for (let li = 0; li < lines.length; li++) { page.drawText(lines[li], { x: x + cellPaddingX, y: yLocal }); yLocal -= headerLineHeight; }
      x += c.width;
    }
    y -= maxHeaderLines * headerLineHeight;
    const totalWidth = columns.reduce((s, c) => s + c.width, 0);
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + totalWidth, y: y - 4 }, color: rgb(0.8,0.8,0.8), thickness: 1 });
    y -= lineHeight; page.setFont(normalFont); page.setFontSize(bodyFontSize);

    // Rows
    for (const r of data.summaries) {
      const vals: Record<string, string> = {
        name: r.name,
        expectedCosts: formatCurrency(r.expectedCosts),
        actualCosts: formatCurrency(r.actualCosts),
        expectedEarnings: formatCurrency(r.expectedEarnings),
        actualEarnings: formatCurrency(r.actualEarnings),
        expectedResult: formatCurrency(r.expectedResult),
        actualResult: formatCurrency(r.actualResult),
      };
      let maxLines = 1; const wrapped: Record<string, string[]> = {};
      for (const c of columns) {
        const lines = wrap(normalFont, bodyFontSize, vals[c.key as keyof typeof vals] ?? '', c.width - cellPaddingX * 2);
        wrapped[c.key] = lines; if (lines.length > maxLines) maxLines = lines.length;
      }
      const required = maxLines * lineHeight + rowGap; ensureSpace(required, () => {
        // redraw header on new page
        y = headerStartY; // reset head pos for header drawing consistency
        // draw header again
        page.setFont(boldFont); page.setFontSize(headerFontSize);
        let x2 = margin; for (let i = 0; i < columns.length; i++) {
          const c = columns[i]; const lines = wrap(boldFont, headerFontSize, c.label, c.width - cellPaddingX * 2);
          let yLocal = y; for (let li = 0; li < lines.length; li++) { page.drawText(lines[li], { x: x2 + cellPaddingX, y: yLocal }); yLocal -= headerLineHeight; }
          x2 += c.width;
        }
        y -= maxHeaderLines * headerLineHeight; page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + totalWidth, y: y - 4 }, color: rgb(0.8,0.8,0.8), thickness: 1 }); y -= lineHeight; page.setFont(normalFont); page.setFontSize(bodyFontSize);
      });

      let x3 = margin; for (const c of columns) {
        const lines = wrapped[c.key]; for (let i = 0; i < lines.length; i++) { page.drawText(lines[i], { x: x3 + cellPaddingX, y: y - i * lineHeight }); }
        x3 += c.width;
      }
      y -= required;
    }

    // Totals (Summenzeile)
    const totals = data.summaries.reduce((acc, r) => {
      acc.expectedCosts += Number(r.expectedCosts || 0);
      acc.actualCosts += Number(r.actualCosts || 0);
      acc.expectedEarnings += Number(r.expectedEarnings || 0);
      acc.actualEarnings += Number(r.actualEarnings || 0);
      acc.expectedResult += Number(r.expectedResult || 0);
      acc.actualResult += Number(r.actualResult || 0);
      return acc;
    }, { expectedCosts: 0, actualCosts: 0, expectedEarnings: 0, actualEarnings: 0, expectedResult: 0, actualResult: 0 });

    // kleine Trennlinie vor Summenzeile
    page.drawLine({ start: { x: margin, y: y - 2 }, end: { x: margin + totalWidth, y: y - 2 }, color: rgb(0.7,0.7,0.7), thickness: 1 });
    y -= lineHeight; // etwas Abstand

    // Summenzeile rendern (Name: "Summe")
    const sumVals: Record<string, string> = {
      name: 'Summe',
      expectedCosts: formatCurrency(totals.expectedCosts),
      actualCosts: formatCurrency(totals.actualCosts),
      expectedEarnings: formatCurrency(totals.expectedEarnings),
      actualEarnings: formatCurrency(totals.actualEarnings),
      expectedResult: formatCurrency(totals.expectedResult),
      actualResult: formatCurrency(totals.actualResult),
    };

    // Bold für Summenzeile
    page.setFont(boldFont); page.setFontSize(bodyFontSize);

    let maxSumLines = 1; const wrappedSum: Record<string, string[]> = {};
    for (const c of columns) {
      const lines = wrap(boldFont, bodyFontSize, sumVals[c.key as keyof typeof sumVals] ?? '', c.width - cellPaddingX * 2);
      wrappedSum[c.key] = lines; if (lines.length > maxSumLines) maxSumLines = lines.length;
    }
    const requiredSum = maxSumLines * lineHeight + rowGap;
    ensureSpace(requiredSum, () => {
      // Bei Umbruch: Header erneut zeichnen, dann nochmal Trennlinie vor Summenzeile
      y = headerStartY;
      page.setFont(boldFont); page.setFontSize(headerFontSize);
      let x2 = margin; for (let i = 0; i < columns.length; i++) {
        const c = columns[i]; const lines = wrap(boldFont, headerFontSize, c.label, c.width - cellPaddingX * 2);
        let yLocal = y; for (let li = 0; li < lines.length; li++) { page.drawText(lines[li], { x: x2 + cellPaddingX, y: yLocal }); yLocal -= headerLineHeight; }
        x2 += c.width;
      }
      y -= maxHeaderLines * headerLineHeight; page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + totalWidth, y: y - 4 }, color: rgb(0.8,0.8,0.8), thickness: 1 }); y -= lineHeight;
      page.drawLine({ start: { x: margin, y: y - 2 }, end: { x: margin + totalWidth, y: y - 2 }, color: rgb(0.7,0.7,0.7), thickness: 1 });
      y -= lineHeight;
      page.setFont(boldFont); page.setFontSize(bodyFontSize);
    });

    let xSum = margin; for (const c of columns) {
      const lines = wrappedSum[c.key]; for (let i = 0; i < lines.length; i++) { page.drawText(lines[i], { x: xSum + cellPaddingX, y: y - i * lineHeight }); }
      xSum += c.width;
    }
    y -= requiredSum;

    // Rückkehr zu normaler Schrift
    page.setFont(normalFont); page.setFontSize(bodyFontSize);
  }

  drawSummaryTable();

  // Details je Kostenstelle (anonym/voll)
  if (data.variant === 'anonym' || data.variant === 'voll') {
    // Abstand
    y -= 8;

    const detailColumnsBase = data.variant === 'voll'
      ? [
          { key: 'date', label: 'Datum', base: 120, min: 90 },
          { key: 'description', label: 'Beschreibung', base: 480, min: 240 },
          { key: 'amount', label: 'Betrag', base: 120, min: 90 },
          { key: 'other', label: 'Konto', base: 180, min: 130 },
        ] as const
      : [
          { key: 'date', label: 'Datum', base: 140, min: 100 },
          { key: 'description', label: 'Beschreibung', base: 640, min: 380 },
          { key: 'amount', label: 'Betrag', base: 140, min: 100 },
        ] as const;
    let widths = computeWidths(detailColumnsBase);

    function drawDetailHeader(cols: any[]) {
      page.setFont(boldFont); page.setFontSize(headerFontSize);
      let x = margin; for (const c of cols) { page.drawText(c.label, { x: x + cellPaddingX, y }); x += c.width; }
      y -= headerLineHeight; const totalWidth = cols.reduce((s, c) => s + c.width, 0);
      page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + totalWidth, y: y - 4 }, color: rgb(0.8,0.8,0.8), thickness: 1 });
      y -= lineHeight; page.setFont(normalFont); page.setFontSize(bodyFontSize);
    }

    for (const block of (data.details || [])) {
      // Abschnittstitel: Kostenstelle
      const heading = `Kostenstelle: ${block.name}`;
      const needed = lineHeight * 3; // etwas Puffer
      ensureSpace(needed);
      page.setFont(boldFont); page.setFontSize(12); page.drawText(heading, { x: margin, y }); y -= 16; page.setFont(normalFont); page.setFontSize(bodyFontSize);

      // Tabelle
      const columns = detailColumnsBase.map((c, i) => ({ ...c, width: widths[i] }));
      drawDetailHeader(columns);

      for (const r of block.txs) {
        const vals: Record<string, string> = {
          date: formatDate(r.date),
          description: r.description || '',
          amount: formatCurrency(r.amount ?? 0),
          other: r.other || '',
        };
        // wrap description and other
        let maxLines = 1; const wrapped: Record<string, string[]> = {};
        for (const c of columns) {
          const lines = wrap(normalFont, bodyFontSize, vals[c.key] ?? '', c.width - cellPaddingX * 2);
          wrapped[c.key] = lines; if (lines.length > maxLines) maxLines = lines.length;
        }
        const required = maxLines * lineHeight + rowGap;
        ensureSpace(required, () => drawDetailHeader(columns));
        let x = margin; for (const c of columns) { const lines = wrapped[c.key]; for (let i = 0; i < lines.length; i++) { page.drawText(lines[i], { x: x + cellPaddingX, y: y - i * lineHeight }); } x += c.width; }
        y -= required;
      }

      y -= 10; // Abstand zum nächsten Block
    }
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
