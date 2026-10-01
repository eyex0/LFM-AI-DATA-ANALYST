import * as XLSX from 'xlsx';

export interface RawColumnInfo {
  name: string;
  type: 'numeric' | 'categorical' | 'date' | 'id';
  nullCount: number;
  distinctCount: number;
  sampleValues: (string | number)[];
  min?: number;
  max?: number;
  sum?: number;
  avg?: number;
  topValue?: string;
  topFrequency?: number;
}

export interface ParsedDatasetSheet {
  sheetName: string;
  fileName: string;
  columns: string[];
  columnDetails: RawColumnInfo[];
  rows: Record<string, any>[];
  totalRows: number;
  totalColumns: number;
  csvContent?: string;
}

/**
 * Checks if a string looks like a date.
 */
function isDateString(val: any): boolean {
  if (val instanceof Date) return true;
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length < 6 || trimmed.length > 30) return false;
  // Common date formats: 2024-05-12, 12/05/2024, May 12 2024, etc.
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(trimmed)) return true;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(trimmed)) return true;
  const parsed = Date.parse(trimmed);
  return !isNaN(parsed) && parsed > 0 && parsed < 2524608000000; // between 1970 and 2050
}

/**
 * Cleanly coerces value to number if possible (handles currency, thousands commas, percentages).
 */
function parseNumericValue(val: any): number | null {
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$€£¥%,\s]/g, '').trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Analyzes columns to detect types, distributions, and summary statistics.
 */
export function profileSheetColumns(columns: string[], rows: Record<string, any>[]): RawColumnInfo[] {
  const rowCount = rows.length;

  return columns.map((colName) => {
    let nullCount = 0;
    let numericCount = 0;
    let dateCount = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const valueMap = new Map<string, number>();
    const samples: (string | number)[] = [];

    const isIdColName = /^(id|_id|uuid|guid|code|pk|fk)$/i.test(colName.trim()) ||
      /(id|code)$/i.test(colName.trim());

    for (let i = 0; i < rowCount; i++) {
      const row = rows[i];
      const val = row[colName];

      if (val === null || val === undefined || val === '') {
        nullCount++;
        continue;
      }

      if (samples.length < 5) {
        samples.push(typeof val === 'object' ? JSON.stringify(val) : val);
      }

      // Check numeric
      const num = parseNumericValue(val);
      if (num !== null && !isIdColName) {
        numericCount++;
        sum += num;
        if (num < min) min = num;
        if (num > max) max = num;
      }

      // Check date
      if (isDateString(val)) {
        dateCount++;
      }

      const strVal = String(val).trim();
      valueMap.set(strVal, (valueMap.get(strVal) || 0) + 1);
    }

    const nonNullCount = rowCount - nullCount;
    const distinctCount = valueMap.size;

    // Determine type
    let type: 'numeric' | 'categorical' | 'date' | 'id' = 'categorical';

    if (isIdColName && distinctCount > nonNullCount * 0.8) {
      type = 'id';
    } else if (dateCount > nonNullCount * 0.6 && nonNullCount > 0) {
      type = 'date';
    } else if (numericCount > nonNullCount * 0.7 && nonNullCount > 0) {
      type = 'numeric';
    } else if (distinctCount === nonNullCount && nonNullCount > 10) {
      type = 'id';
    }

    // Find top frequency value
    let topValue = '';
    let topFrequency = 0;
    valueMap.forEach((freq, val) => {
      if (freq > topFrequency) {
        topFrequency = freq;
        topValue = val;
      }
    });

    const info: RawColumnInfo = {
      name: colName,
      type,
      nullCount,
      distinctCount,
      sampleValues: samples,
    };

    if (type === 'numeric' && numericCount > 0) {
      info.min = min === Infinity ? 0 : min;
      info.max = max === -Infinity ? 0 : max;
      info.sum = sum;
      info.avg = sum / numericCount;
    }

    if (topValue) {
      info.topValue = topValue;
      info.topFrequency = topFrequency;
    }

    return info;
  });
}

/**
 * Parses an Excel file (.xlsx, .xls) from File or ArrayBuffer into one or more ParsedDatasetSheet objects.
 */
export async function parseExcelFile(file: File): Promise<ParsedDatasetSheet[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    dateNF: 'yyyy-mm-dd',
  });

  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error(`Excel workbook "${file.name}" has no worksheets.`);
  }

  const results: ParsedDatasetSheet[] = [];

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert to JSON objects
    const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, {
      defval: null,
      raw: false,
      dateNF: 'yyyy-mm-dd',
    });

    if (rawRows.length === 0) continue;

    // Find all distinct column headers
    const colSet = new Set<string>();
    rawRows.forEach((r) => {
      Object.keys(r).forEach((k) => {
        const cleanedKey = k.trim();
        if (cleanedKey && !cleanedKey.startsWith('__EMPTY')) {
          colSet.add(cleanedKey);
        }
      });
    });

    const columns = Array.from(colSet);
    if (columns.length === 0) continue;

    const columnDetails = profileSheetColumns(columns, rawRows);
    const csvContent = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });

    results.push({
      sheetName,
      fileName: file.name,
      columns,
      columnDetails,
      rows: rawRows,
      totalRows: rawRows.length,
      totalColumns: columns.length,
      csvContent,
    });
  }

  if (results.length === 0) {
    throw new Error(`Excel workbook "${file.name}" contains no readable data tables.`);
  }

  return results;
}

/**
 * Parses CSV text content into a ParsedDatasetSheet.
 */
export function parseCsvDataset(csvContent: string, fileName: string, sheetName = 'Sheet1'): ParsedDatasetSheet {
  const workbook = XLSX.read(csvContent, {
    type: 'string',
    cellDates: true,
    dateNF: 'yyyy-mm-dd',
  });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: Record<string, any>[] = sheet
    ? XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, dateNF: 'yyyy-mm-dd' })
    : [];

  const colSet = new Set<string>();
  rawRows.forEach((r) => {
    Object.keys(r).forEach((k) => {
      const cleaned = k.trim();
      if (cleaned && !cleaned.startsWith('__EMPTY')) {
        colSet.add(cleaned);
      }
    });
  });

  const columns = Array.from(colSet);
  const columnDetails = profileSheetColumns(columns, rawRows);

  return {
    sheetName,
    fileName,
    columns,
    columnDetails,
    rows: rawRows,
    totalRows: rawRows.length,
    totalColumns: columns.length,
    csvContent,
  };
}

/**
 * Exports a ParsedDatasetSheet to an Excel (.xlsx) file downloaded by the browser.
 */
export function exportSheetToExcel(sheet: ParsedDatasetSheet, customFileName?: string): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheet.rows);
  XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName || 'Data');
  
  const baseName = customFileName || sheet.fileName.replace(/\.[^/.]+$/, '') || 'dataset';
  const outName = `${baseName}_export.xlsx`;
  XLSX.writeFile(wb, outName);
}

/**
 * Exports a ParsedDatasetSheet to a CSV file downloaded by the browser.
 */
export function exportSheetToCsv(sheet: ParsedDatasetSheet, customFileName?: string): void {
  const csv = sheet.csvContent || XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(sheet.rows));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const baseName = customFileName || sheet.fileName.replace(/\.[^/.]+$/, '') || 'dataset';
  link.setAttribute('download', `${baseName}_export.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
