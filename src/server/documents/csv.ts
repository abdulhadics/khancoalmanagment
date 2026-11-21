type CsvCell = string | bigint | { decimal: string } | null;

export function csvDecimal(value: string | null): CsvCell {
  return value === null ? null : { decimal: value };
}

function encodeCell(cell: CsvCell): string {
  if (cell === null) return '""';
  if (typeof cell === "bigint") return cell.toString();
  if (typeof cell === "object") {
    if (
      !/^-?\d+(?:\.\d+)?$/u.test(cell.decimal) ||
      cell.decimal !== cell.decimal.trim()
    ) {
      throw new RangeError("CSV decimal is invalid.");
    }
    return cell.decimal;
  }

  // Excel treats a quoted cell with a tab before the operand as text. Check
  // the normalized prefix while preserving the original spelling in the CSV.
  const probe = cell.normalize("NFKC").replace(/^[\s\p{C}]*/u, "");
  const dangerous = /^[=+@-]/u.test(probe) || /^[\t\r\n]/u.test(cell);
  const literal = dangerous ? `\t${cell}` : cell;
  return `"${literal.replaceAll('"', '""')}"`;
}

export function renderCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): Uint8Array<ArrayBuffer> {
  const lines = [header, ...rows].map((row) => {
    if (row.length !== header.length)
      throw new Error("CSV column count does not match.");
    return row.map(encodeCell).join(",");
  });
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
