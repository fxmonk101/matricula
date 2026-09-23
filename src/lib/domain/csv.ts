/**
 * =============================================================================
 * READING A SPREADSHEET SOMEBODY ELSE MADE
 * =============================================================================
 *
 * A registry does not hand you clean data. It hands you a file exported from
 * Excel by somebody who has been keeping the intake in it since 2019, and every
 * awkward thing below is something such a file actually contains:
 *
 *   · a UTF-8 BOM, which makes the first header "﻿First Name" and silently
 *     breaks every column match unless it is stripped
 *   · CRLF line endings, mixed with LF where somebody edited it on a Mac
 *   · quoted fields containing commas ("Lagos, Nigeria") and newlines (an
 *     address typed with Alt+Enter)
 *   · doubled quotes ("" ) meaning one literal quote
 *   · trailing blank lines, and rows that are entirely empty
 *   · headers that differ from ours in case, spacing and wording
 *
 * `split(',')` handles none of it, and the failure mode is not an error — it is
 * a student whose address swallowed their phone number. So the parser is a
 * character-wise state machine, which is the only way to read this format
 * correctly, and it is pure so it can be tested against those cases directly.
 *
 * NOT a general CSV library. It reads a header row and returns records; it does
 * not stream, and it does not write.
 */

export interface CsvTable {
  /** Header names exactly as they appeared, BOM and outer spaces removed. */
  headers: string[];
  /**
   * One entry per data row. Short rows are padded with empty strings, so a
   * caller never has to distinguish "missing column" from "empty cell" —
   * the file's own author almost certainly did not intend a distinction.
   */
  rows: string[][];
}

/** Rows and cells beyond this are refused rather than exhausting memory. */
export const CSV_LIMITS = {
  maxRows: 20_000,
  maxCells: 400_000,
  maxBytes: 8 * 1024 * 1024,
} as const;

export class CsvError extends Error {}

/**
 * Parse delimited text.
 *
 * The delimiter is detected rather than assumed: a spreadsheet saved in a
 * locale that uses a comma for decimals exports semicolons, and a registry
 * pasting from a database often has tabs. Guessing wrong turns every row into
 * a single column, which at least fails loudly — but detecting is cheap.
 */
export function parseCsv(input: string, delimiter?: string): CsvTable {
  // The BOM, removed once, before anything looks at the first header.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let cells = 0;

  const endField = () => {
    row.push(field);
    field = '';
    cells += 1;
    if (cells > CSV_LIMITS.maxCells) {
      throw new CsvError(`That file has more than ${CSV_LIMITS.maxCells} cells.`);
    }
  };

  const endRow = () => {
    endField();
    // A row of nothing but empty cells is a blank line, not a record. Excel
    // adds them at the end of a file as a matter of course.
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
    if (rows.length > CSV_LIMITS.maxRows) {
      throw new CsvError(`That file has more than ${CSV_LIMITS.maxRows} rows.`);
    }
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === sep) {
      endField();
    } else if (char === '\r') {
      // CRLF and a lone CR both end the row; the LF is stepped over.
      if (text[i + 1] === '\n') i += 1;
      endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
    }
  }

  // Whatever is left when the text runs out is the last row, unless the file
  // ended on a newline and left nothing behind.
  if (field !== '' || row.length > 0) endRow();

  if (rows.length === 0) throw new CsvError('That file has no rows in it.');

  const headers = rows[0].map((h) => h.trim());
  const width = headers.length;

  const body = rows.slice(1).map((r) => {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded.map((cell) => cell.trim());
  });

  return { headers, rows: body };
}

/**
 * Which character separates the columns.
 *
 * Counted on the first line only, outside quotes. The winner is whichever
 * appears most; a tie falls back to a comma, which is what the format is
 * nominally called.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;

  for (const candidate of [',', ';', '\t', '|']) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const char = firstLine[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

// -----------------------------------------------------------------------------
// Matching their column names to ours
// -----------------------------------------------------------------------------

/**
 * Reduce a header to something comparable.
 *
 * "First Name", "first_name", "FIRSTNAME" and "First  name " are the same
 * column, and a registry's file will use whichever its author typed. Matching
 * on the exact string would mean rejecting a perfectly good file over a space.
 */
export function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface ColumnSpec {
  /** The field this column fills. */
  key: string;
  /** Accepted spellings, ours first. Compared after `normaliseHeader`. */
  aliases: readonly string[];
  required?: boolean;
}

export interface ColumnMap {
  /** field key -> index into a row, for the columns that were found. */
  index: Record<string, number>;
  /** Required fields with no matching column. */
  missing: string[];
  /** Headers in the file that matched nothing — reported, never guessed at. */
  unmatched: string[];
}

/**
 * Line their headers up with ours.
 *
 * Unmatched columns are REPORTED rather than ignored. A file with a "Guardian
 * Phone" column that this importer does not read is worth telling somebody
 * about: they think they have imported it.
 */
export function mapColumns(headers: readonly string[], specs: readonly ColumnSpec[]): ColumnMap {
  const normalised = headers.map(normaliseHeader);
  const index: Record<string, number> = {};
  const used = new Set<number>();

  for (const spec of specs) {
    for (const alias of spec.aliases) {
      const want = normaliseHeader(alias);
      const at = normalised.findIndex((h, i) => h === want && !used.has(i));
      if (at !== -1) {
        index[spec.key] = at;
        used.add(at);
        break;
      }
    }
  }

  return {
    index,
    missing: specs.filter((s) => s.required && index[s.key] === undefined).map((s) => s.key),
    unmatched: headers.filter((_, i) => !used.has(i) && headers[i].trim() !== ''),
  };
}

/** Read one cell, or an empty string when the column is absent. */
export function cell(row: readonly string[], map: ColumnMap, key: string): string {
  const at = map.index[key];
  return at === undefined ? '' : (row[at] ?? '').trim();
}
