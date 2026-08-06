// CSV export encoding. Small, but two things here are easy to get wrong in
// opposite directions, so they live in one tested place (finding C12).

/**
 * Byte-order mark. Excel opens a UTF-8 CSV as the system codepage unless the
 * file starts with one, which mangles every non-ASCII column name and value —
 * and this app's users export questionnaire items in every script there is.
 */
export const CSV_BOM = '﻿';

// Excel and Sheets treat a cell opening with any of these as a formula, so a
// value like `=HYPERLINK(...)` in an exported file becomes executable content
// in whatever opens it next.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Encode one cell: RFC 4180 quoting, plus a formula guard.
 *
 * The guard deliberately does NOT fire on anything that reads as a number.
 * `-` is a formula lead character AND the minus sign, and this app exports PC
 * scores, z-scores and correlations — negative numbers are everywhere. Escaping
 * them would corrupt the common case to defend against the rare one, and a
 * numeric cell cannot be a formula in any case. So: numbers pass through
 * untouched, and only text that opens like a formula is prefixed with an
 * apostrophe, which is the convention spreadsheets read as "this is literal".
 */
export const csvCell = (value: unknown): string => {
  if (value == null) return '';
  const text = String(value);
  if (text === '') return '';

  // Number check first, so -3.5 and +1e4 stay exactly as they are.
  const isNumeric = Number.isFinite(Number(text.trim())) && text.trim() !== '';
  const guarded = !isNumeric && FORMULA_LEAD.test(text) ? `'${text}` : text;

  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};
