/** CSV exported to spreadsheets must treat user-entered values as text. */
export function encodeCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^[\s\uFEFF]*[=+\-@]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n") + "\r\n";
}

export function parseCsv(source: string, limit = 501) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let rowStarted = false;

  function finishField() {
    row.push(field);
    if (row.length > 100) throw new Error("CSV files can have at most 100 columns");
    field = "";
    closedQuote = false;
  }

  function finishRow() {
    finishField();
    if (row.some((value) => value.trim())) rows.push(row);
    if (rows.length > limit) throw new Error(`CSV files can have at most ${limit - 1} task rows`);
    row = [];
    rowStarted = false;
  }

  const text = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += char;
      }
    } else if (char === ",") {
      rowStarted = true;
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else if (closedQuote) {
      throw new Error("Unexpected text after a quoted CSV field");
    } else if (char === '"') {
      if (field) throw new Error("A quoted CSV field must start with a quote");
      quoted = true;
      rowStarted = true;
    } else {
      field += char;
      rowStarted = true;
    }
  }
  if (quoted) throw new Error("An opening quote in the CSV file has no closing quote");
  if (rowStarted || row.length) finishRow();
  return rows;
}
