import { formatDocumentDate } from "@/domain/document-format";
import { formatDecimal } from "@/domain/number-display";
import { dispatchPrint as copy } from "@/i18n/messages/dispatch-print-en";
import {
  documentBottom,
  documentInk,
  documentInset,
  documentMutedInk,
  documentRule,
  documentTint,
  documentWidth,
  drawDocumentField,
  printableText,
  renderPdf,
  type PdfDocument,
} from "@/server/documents/pdf";
import type {
  DailyPrintData,
  DispatchSummaryRow,
  SlipPrintData,
} from "./print";

function statusLabel(row: DispatchSummaryRow) {
  return row.status === "POSTED" ? copy.posted : copy.pending;
}

export function renderDispatchSlip(data: SlipPrintData) {
  const { profile, row } = data;
  return renderPdf(
    { ...data, layout: "portrait", title: `${copy.slip} - ${row.orderNo}` },
    (doc) => {
      const width = documentWidth(doc);
      doc
        .font("Inter Semibold")
        .fillColor(documentInk)
        .fontSize(24)
        .text(copy.slip, documentInset, doc.y, { width });
      doc
        .font("Inter")
        .fillColor(documentMutedInk)
        .fontSize(11)
        .text(
          `${row.orderNo}  |  ${statusLabel(row)}`,
          documentInset,
          doc.y + 5,
          { width },
        );

      const fields = [
        [copy.date, formatDocumentDate(data.date, profile.dateFormat)],
        [copy.vehicle, row.vehicle],
        [copy.customer, row.customer],
        [copy.supplier, row.supplier],
        [copy.mine, row.mine],
        [
          copy.weight,
          `${formatDecimal(row.weight, 3, profile.numberFormat)} ${copy.units[profile.weightUnit]}`,
        ],
        [copy.bilty, data.bilty],
      ] as const;

      const gap = 28;
      const column = (width - gap) / 2;
      let y = doc.y + 28;
      for (let index = 0; index < fields.length; index += 2) {
        const [first, second] = fields.slice(index, index + 2);
        const bottom = drawDocumentField(
          doc,
          first[0],
          first[1],
          documentInset,
          y,
          column,
        );
        const otherBottom = second
          ? drawDocumentField(
              doc,
              second[0],
              second[1],
              documentInset + column + gap,
              y,
              column,
            )
          : bottom;
        y = Math.max(bottom, otherBottom) + 15;
      }

      if (data.notes) {
        doc
          .lineWidth(0.5)
          .strokeColor(documentRule)
          .moveTo(documentInset, y + 1)
          .lineTo(documentInset + width, y + 1)
          .stroke();
        drawDocumentField(
          doc,
          copy.notes,
          data.notes,
          documentInset,
          y + 13,
          width,
        );
      }
    },
  );
}

type Column = {
  label: string;
  weight: number;
  number?: boolean;
  singleLine?: boolean;
};
type TableColumn = Column & { x: number; width: number };
const cellPad = 5;
const bodySize = 8.5;

function dailyColumns(data: DailyPrintData): Column[] {
  const { currencySymbol, weightUnit } = data.profile;
  const operational: Column[] = [
    { label: copy.order, weight: 1.16, singleLine: true },
    { label: copy.customer, weight: 1.55 },
    { label: copy.supplier, weight: 1.55 },
    { label: copy.mine, weight: 1.15 },
    { label: copy.vehicle, weight: 1.0 },
    {
      label: `${copy.weight} (${copy.units[weightUnit]})`,
      weight: 0.95,
      number: true,
    },
    { label: copy.status, weight: 1.0 },
  ];
  return data.financial
    ? [
        ...operational,
        ...[copy.buy, copy.sell, copy.profit].map((label) => ({
          label: `${label} (${currencySymbol})`,
          weight: 1.05,
          number: true,
        })),
      ]
    : operational;
}

function positions(columns: Column[], width: number): TableColumn[] {
  const sum = columns.reduce((total, column) => total + column.weight, 0);
  let x = documentInset;
  return columns.map((column) => {
    const size = (column.weight / sum) * width;
    const positioned = { ...column, x, width: size };
    x += size;
    return positioned;
  });
}

function rowHeights(
  doc: PdfDocument,
  columns: TableColumn[],
  cells: string[],
  header: boolean,
) {
  return cells.map((value, index) => {
    const col = columns[index];
    const width = col.width - 2 * cellPad;
    const singleLine = !header && (col.number || col.singleLine);
    doc.fontSize(bodySize);
    const cellSize = singleLine
      ? Math.min(
          bodySize,
          (bodySize * (width - 0.5)) / Math.max(1, doc.widthOfString(value)),
        )
      : bodySize;
    doc.fontSize(cellSize);
    const height = singleLine
      ? bodySize + 2
      : doc.heightOfString(value, { width, lineGap: 1 });
    return {
      value,
      column: col,
      width,
      height,
      fontSize: cellSize,
      singleLine,
    };
  });
}

function tableRow(
  doc: PdfDocument,
  columns: TableColumn[],
  cells: string[],
  y: number,
  { header = false, shaded = false, measureOnly = false } = {},
) {
  const measured = rowHeights(doc, columns, cells, header);
  const height =
    Math.max(12, ...measured.map((cell) => cell.height)) + cellPad * 2;
  if (measureOnly) return height;
  if (header || shaded) {
    doc.rect(documentInset, y, documentWidth(doc), height).fill(documentTint);
  }
  for (const cell of measured) {
    doc
      .fontSize(cell.fontSize)
      .fillColor(header ? documentMutedInk : documentInk);
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

function dailyCells(row: DispatchSummaryRow, data: DailyPrintData): string[] {
  const { numberFormat } = data.profile;
  const cells = [
    row.orderNo,
    row.customer,
    row.supplier,
    row.mine,
    row.vehicle,
    formatDecimal(row.weight, 3, numberFormat),
    statusLabel(row),
  ];
  if (data.financial) {
    const financial = row.financial;
    for (const value of [financial?.buy, financial?.sell, financial?.profit]) {
      cells.push(value ? formatDecimal(value, 2, numberFormat) : copy.missing);
    }
  }
  return cells.map(printableText);
}

function dailyTotals(data: DailyPrintData): string[] {
  const { numberFormat } = data.profile;
  const cells = [
    copy.total,
    "",
    "",
    "",
    "",
    formatDecimal(data.totals.weight, 3, numberFormat),
    "",
  ];
  if (data.financial) {
    cells.push(
      formatDecimal(data.totals.buy, 2, numberFormat),
      formatDecimal(data.totals.sell, 2, numberFormat),
      formatDecimal(data.totals.profit, 2, numberFormat),
    );
  }
  return cells;
}

export function renderDailyDispatch(data: DailyPrintData) {
  return renderPdf({ ...data, layout: "landscape", title: copy.day }, (doc) => {
    const width = documentWidth(doc);
    const columns = positions(dailyColumns(data), width);
    const headings = columns.map((column) => printableText(column.label));
    const date = formatDocumentDate(data.date, data.profile.dateFormat);
    const count = copy.entryCount(
      formatDecimal(BigInt(data.rows.length), 0, data.profile.numberFormat),
    );

    function pageHeader() {
      doc
        .font("Inter Semibold")
        .fillColor(documentInk)
        .fontSize(20)
        .text(copy.day, documentInset, doc.y, { width });
      doc
        .font("Inter")
        .fillColor(documentMutedInk)
        .fontSize(9)
        .text(`${date}  |  ${count}`, documentInset, doc.y + 5, { width });
      const top = doc.y + 12;
      return top + tableRow(doc, columns, headings, top, { header: true });
    }

    let y = pageHeader();
    if (data.rows.length === 0) {
      doc
        .fillColor(documentMutedInk)
        .fontSize(10)
        .text(copy.empty, documentInset + cellPad, y + 11, {
          width: width - 2 * cellPad,
        });
      return;
    }

    function addRow(cells: string[], shaded = false) {
      const height = tableRow(doc, columns, cells, y, { measureOnly: true });
      if (y + height > documentBottom(doc)) {
        doc.addPage();
        y = pageHeader();
      }
      y += tableRow(doc, columns, cells, y, { shaded });
    }
    for (const row of data.rows) addRow(dailyCells(row, data));
    addRow(dailyTotals(data), true);
  });
}
