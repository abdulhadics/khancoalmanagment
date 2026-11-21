import {
  documentBottom,
  documentInk,
  documentInset,
  documentMutedInk,
  documentRule,
  documentTint,
  documentWidth,
  printableText,
  renderPdf,
  type PdfDocument,
} from "./pdf";
import type { DocumentProfile } from "./print-data";

export type PdfTableColumn = {
  label: string;
  weight: number;
  number?: boolean;
  singleLine?: boolean;
};
type Column = PdfTableColumn & { x: number; width: number };
type Cell = string | readonly string[];

type TablePrint = {
  profile: DocumentProfile;
  generatedAt: Date;
  preparedBy: string;
  title: string;
  subtitle: string;
  columns: readonly PdfTableColumn[];
  rows: readonly (readonly Cell[])[];
  totalRows: readonly (readonly Cell[])[];
  emptyMessage: string;
};

const cellPad = 5;
const bodySize = 8.5;

function positionColumns(
  columns: readonly PdfTableColumn[],
  width: number,
): Column[] {
  const weight = columns.reduce((total, column) => total + column.weight, 0);
  let x = documentInset;
  return columns.map((column) => {
    const size = (column.weight / weight) * width;
    const result = { ...column, x, width: size };
    x += size;
    return result;
  });
}

function measureRow(
  doc: PdfDocument,
  columns: Column[],
  cells: readonly Cell[],
  heading: boolean,
) {
  if (columns.length !== cells.length)
    throw new Error("PDF table column count does not match.");

  const measured = cells.map((entry, index) => {
    const value =
      typeof entry === "string"
        ? printableText(entry)
        : entry.map(printableText).join("\n");
    const column = columns[index];
    const width = column.width - 2 * cellPad;
    const singleLine =
      !heading && !value.includes("\n") && (column.number || column.singleLine);
    doc.fontSize(bodySize);
    const fontSize = singleLine
      ? Math.min(
          bodySize,
          (bodySize * (width - 0.5)) / Math.max(1, doc.widthOfString(value)),
        )
      : bodySize;
    doc.fontSize(fontSize);
    const height = singleLine
      ? bodySize + 2
      : doc.heightOfString(value, { width, lineGap: 1 });
    return { column, width, height, fontSize, value };
  });

  return {
    cells: measured,
    height: Math.max(12, ...measured.map((cell) => cell.height)) + 2 * cellPad,
  };
}

function drawRow(
  doc: PdfDocument,
  row: ReturnType<typeof measureRow>,
  y: number,
  style: "heading" | "body" | "total",
) {
  const { height } = row;
  if (style !== "body") {
    doc.rect(documentInset, y, documentWidth(doc), height).fill(documentTint);
  }
  for (const cell of row.cells) {
    doc
      .fontSize(cell.fontSize)
      .fillColor(style === "heading" ? documentMutedInk : documentInk);
    doc.text(cell.value, cell.column.x + cellPad, y + cellPad, {
      width: cell.width,
      height: cell.height,
      align: cell.column.number ? "right" : "left",
      lineGap: 1,
    });
  }
  doc
    .lineWidth(0.35)
    .strokeColor(documentRule)
    .moveTo(documentInset, y + height)
    .lineTo(documentInset + documentWidth(doc), y + height)
    .stroke();
  return height;
}

export function renderTablePdf(data: TablePrint) {
  return renderPdf({ ...data, layout: "landscape" }, (doc) => {
    const width = documentWidth(doc);
    const columns = positionColumns(data.columns, width);
    const headings = columns.map(({ label }) => label);

    function pageHeader() {
      doc
        .font("Inter Semibold")
        .fillColor(documentInk)
        .fontSize(20)
        .text(data.title, documentInset, doc.y, { width });
      doc
        .font("Inter")
        .fillColor(documentMutedInk)
        .fontSize(9)
        .text(printableText(data.subtitle), documentInset, doc.y + 5, {
          width,
        });
      const top = doc.y + 12;
      return (
        top +
        drawRow(doc, measureRow(doc, columns, headings, true), top, "heading")
      );
    }

    let y = pageHeader();
    if (data.rows.length === 0) {
      doc
        .fillColor(documentMutedInk)
        .fontSize(10)
        .text(data.emptyMessage, documentInset + cellPad, y + 11, {
          width: width - 2 * cellPad,
        });
      y = doc.y + 10;
    }

    function writeRow(values: readonly Cell[], style: "body" | "total") {
      const row = measureRow(doc, columns, values, false);
      if (y + row.height > documentBottom(doc)) {
        doc.addPage();
        y = pageHeader();
      }
      y += drawRow(doc, row, y, style);
    }

    for (const row of data.rows) writeRow(row, "body");
    for (const row of data.totalRows) writeRow(row, "total");
  });
}
