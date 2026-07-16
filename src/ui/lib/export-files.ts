export type CsvValue = string | number | boolean | null | undefined;

export function exportTimestampTag(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

/** Quote a CSV field and neutralize spreadsheet formula prefixes in strings. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((_, index) => csvCell(row[index])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function flattenInto(
  value: unknown,
  prefix: string,
  output: Record<string, CsvValue>,
): void {
  if (value === null || value === undefined) {
    output[prefix] = null;
    return;
  }
  if (Array.isArray(value)) {
    output[prefix] = JSON.stringify(value);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      flattenInto(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return;
  }
  output[prefix] =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? value
      : String(value);
}

/** Flatten nested objects to dotted columns; arrays remain JSON in one cell. */
export function objectsToCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";
  const flattened = records.map((record) => {
    const output: Record<string, CsvValue> = {};
    flattenInto(record, "", output);
    return output;
  });
  const headers = Array.from(
    new Set(flattened.flatMap((record) => Object.keys(record))),
  );
  return rowsToCsv(
    headers,
    flattened.map((record) => headers.map((header) => record[header])),
  );
}

export function downloadText(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(
    `${JSON.stringify(value, null, 2)}\n`,
    filename,
    "application/json;charset=utf-8",
  );
}

export function downloadCsv(filename: string, content: string): void {
  downloadText(content, filename, "text/csv;charset=utf-8");
}
