/**
 * exportDocument — browser-side export of output text to Word (.docx) and
 * PDF (.pdf), affiancato a "Copia" sui due pannelli del WireframeWorkArea.
 *
 * Founder direttiva SID-20260530: due bottoni "📄 Word" / "📕 PDF" accanto a
 * "Copia" su entrambi i pannelli output (pseudonimizzato in Codifica,
 * originale ricostruito in Decodifica). Lato-browser only — niente server,
 * niente upload. La generazione del file avviene in-process e viene
 * scaricata via `<a download>`.
 *
 * Libraries:
 *   - DOCX → `docx` (npm). Scelta vs html-docx-js: API tipata, supporto
 *     paragrafi nativo, ampia adozione, zero quirks su Office 365.
 *   - PDF  → `jspdf` (npm). Scelta vs pdfmake: bundle più piccolo, API
 *     stabile, ampiamente utilizzata. `pdfjs-dist` (già in deps) è solo
 *     render/parse — NON serve per scrittura.
 *
 * Privacy: NO metadati identificativi nei file generati (no autore, no
 * titolo del documento col nome utente). Solo contenuto + filename
 * timestamped.
 */

import { Document, Packer, Paragraph, TextRun } from 'docx'
import { jsPDF } from 'jspdf'

/**
 * Filename canonico: `recode-<context>-YYYYMMDD-HHmm.<ext>`.
 * `context` = "codifica" | "decodifica" (sempre italiano — è il brand del
 * prodotto, non l'UI locale). Esempio: `recode-codifica-20260530-1645.docx`.
 */
export function formatExportFilename(
  context: 'codifica' | 'decodifica',
  extension: 'docx' | 'pdf',
  now: Date = new Date(),
): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const hh = pad(now.getHours())
  const mm = pad(now.getMinutes())
  return `recode-${context}-${y}${m}${d}-${hh}${mm}.${extension}`
}

/**
 * Trigger browser download di un blob con `filename`. Usa
 * `URL.createObjectURL` + `<a download>` (pattern standard browser-side).
 * Revoca la URL dopo il click per non leakare il blob in memoria.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke per evitare race con some browser implementations.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Esporta `text` come `.docx`. Mantiene line break paragrafo per
 * paragrafo (split su `\n`). Font default Calibri 11 (default Word).
 */
export async function exportToWord(text: string, filename: string): Promise<void> {
  // Split paragraph-by-paragraph; ogni linea diventa un Paragraph distinto.
  // Linee vuote diventano paragrafi vuoti (preservano la spaziatura).
  const lines = text.split(/\r?\n/)
  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, font: 'Calibri', size: 22 })],
        // size in docx è half-points → 22 = 11pt
      }),
  )

  const doc = new Document({
    // NO creator/title/description — privacy-first.
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, filename)
}

/**
 * Esporta `text` come `.pdf`. Font Helvetica 11, wrapping automatico,
 * paginazione automatica. Mantiene line break del testo originale.
 */
export function exportToPdf(text: string, filename: string): void {
  const pdf = new jsPDF({
    unit: 'pt',
    format: 'a4',
    // NO compress filter che leak metadati.
  })

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 56 // ~2cm
  const marginY = 56
  const lineHeight = 14 // ~11pt * 1.27
  const maxWidth = pageWidth - 2 * marginX

  // splitTextToSize gestisce wrapping; passiamo riga per riga in modo da
  // preservare line break manuali del testo sorgente.
  const lines = text.split(/\r?\n/)
  let y = marginY

  for (const rawLine of lines) {
    const wrapped: string[] =
      rawLine.length === 0 ? [''] : pdf.splitTextToSize(rawLine, maxWidth)
    for (const segment of wrapped) {
      if (y + lineHeight > pageHeight - marginY) {
        pdf.addPage()
        y = marginY
      }
      // jsPDF non scrive null/undefined gracefully; force-string.
      pdf.text(segment, marginX, y)
      y += lineHeight
    }
  }

  const blob = pdf.output('blob')
  downloadBlob(blob, filename)
}
