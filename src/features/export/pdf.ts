import type { ExportDoc } from './mist';

/** Render an ExportDoc as a simple, printable A4/Letter PDF. Fully offline. */
export async function docToPdf(d: ExportDoc): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 48;
  let y = M;
  const ensure = (h: number) => {
    if (y + h > H - M) {
      pdf.addPage();
      y = M;
    }
  };
  const write = (text: string, size: number, style: 'normal' | 'bold' = 'normal', indent = 0) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    // jsPDF's base fonts don't cover every glyph; normalise a few.
    const safe = text.replace(/[☐]/g, '[ ]').replace(/[—–]/g, '-').replace(/[·]/g, '|');
    const lines = pdf.splitTextToSize(safe, W - M * 2 - indent) as string[];
    for (const l of lines) {
      ensure(size * 1.4);
      pdf.text(l, M + indent, y);
      y += size * 1.4;
    }
  };

  write(d.title, 20, 'bold');
  write(d.subtitle, 10);
  y += 6;
  pdf.setFillColor(255, 243, 205);
  const bannerLines = pdf.splitTextToSize(d.banner, W - M * 2 - 16) as string[];
  const bh = bannerLines.length * 14 + 12;
  ensure(bh);
  pdf.rect(M, y - 4, W - M * 2, bh, 'F');
  y += 10;
  write(d.banner, 10, 'bold', 8);
  y += 10;
  for (const s of d.sections) {
    ensure(40);
    write(s.heading, 13, 'bold');
    for (const l of s.lines) write(l, 11, 'normal', 12);
    y += 8;
  }
  y += 8;
  write(d.footer, 8);
  return pdf.output('blob');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
