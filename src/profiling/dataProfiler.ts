import type { ColumnProfile, DataProfile } from '../core/contracts';

/**
 * Checks if a string or object represents a valid date.
 */
function isDateLike(val: unknown): boolean {
  if (val instanceof Date && !isNaN(val.getTime())) return true;
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length < 5 || trimmed.length > 35) return false;
  // Patterns like 2024-05-12, 12/05/2024, May 12, 2024, etc.
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(trimmed)) return true;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(trimmed)) return true;
  const parsed = Date.parse(trimmed);
  return !isNaN(parsed) && parsed > -62167219200000 && parsed < 2524608000000;
}

/**
 * Parses numeric values safely handling currencies, percent signs, and comma decimals.
 */
function parseNumeric(val: unknown): number | null {
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

export class DataProfiler {
  /**
   * Generates a comprehensive DataProfile for tabular data.
   */
  public static profileTable(
    rows: Record<string, unknown>[],
    datasetId: string = 'ds_' + Math.random().toString(36).substring(2, 9),
    versionId: string = 'v1',
    sheetName?: string
  ): DataProfile {
    const rowCount = rows.length;
    if (rowCount === 0) {
      return {
        datasetId,
        versionId,
        sheetName,
        rowCount: 0,
        columnCount: 0,
        columns: [],
        duplicateRowCount: 0,
        duplicateRate: 0,
        overallQualityScore: 100,
        potentialIdentifiers: [],
        potentialMetrics: [],
        potentialDimensions: [],
        potentialTimeColumns: [],
        profiledAt: new Date().toISOString(),
      };
    }

    const columns = Object.keys(rows[0] || {});
    const columnCount = columns.length;

    // Detect duplicate rows using a fast row signature hash
    const seenRowSignatures = new Set<string>();
    let duplicateRows = 0;
    for (let i = 0; i < rowCount; i++) {
      const sig = JSON.stringify(rows[i]);
      if (seenRowSignatures.has(sig)) {
        duplicateRows++;
      } else {
        seenRowSignatures.add(sig);
      }
    }
    const duplicateRate = rowCount > 0 ? Number((duplicateRows / rowCount).toFixed(4)) : 0;

    const columnProfiles: ColumnProfile[] = [];
    const potentialIdentifiers: string[] = [];
    const potentialMetrics: string[] = [];
    const potentialDimensions: string[] = [];
    const potentialTimeColumns: string[] = [];

    let totalQualityScoreDeductions = 0;

    for (const colName of columns) {
      let nullCount = 0;
      let numericCount = 0;
      let dateCount = 0;
      let booleanCount = 0;

      const numValues: number[] = [];
      const distinctValues = new Set<string>();
      const sampleValues: unknown[] = [];
      const qualityIssues: string[] = [];

      for (let i = 0; i < rowCount; i++) {
        const val = rows[i][colName];
        if (val === null || val === undefined || val === '') {
          nullCount++;
          continue;
        }

        const strVal = String(val).trim();
        distinctValues.add(strVal);

        if (sampleValues.length < 5 && !sampleValues.includes(val)) {
          sampleValues.push(val);
        }

        // Numeric check
        const num = parseNumeric(val);
        if (num !== null) {
          numericCount++;
          numValues.push(num);
        }

        // Date check
        if (isDateLike(val)) {
          dateCount++;
        }

        // Boolean check
        if (typeof val === 'boolean' || /^(true|false|si|no|yes|1|0)$/i.test(strVal)) {
          booleanCount++;
        }
      }

      const validCount = rowCount - nullCount;
      const nullRate = rowCount > 0 ? Number((nullCount / rowCount).toFixed(4)) : 0;
      const uniqueCount = distinctValues.size;

      // Infer Data Type
      let dataType: 'string' | 'number' | 'date' | 'boolean' | 'unknown' = 'string';
      if (validCount > 0) {
        if (dateCount / validCount >= 0.75) {
          dataType = 'date';
        } else if (numericCount / validCount >= 0.85) {
          dataType = 'number';
        } else if (booleanCount / validCount >= 0.85 && uniqueCount <= 3) {
          dataType = 'boolean';
        }
      }

      // Check if it's an Identifier
      const isIdColName = /^(id|_id|uuid|guid|code|pk|fk)$/i.test(colName.trim()) ||
        /(id|code|sku|isin|ean)$/i.test(colName.trim());
      const isIdentifier = (uniqueCount === validCount && validCount > 10) || isIdColName;
      if (isIdentifier) potentialIdentifiers.push(colName);

      // Check if it's a Time / Date column
      const isDateColName = /date|time|period|year|month|week|quarter|giorno|settimana|anno|mese/i.test(colName);
      const isDate = dataType === 'date' || (isDateColName && uniqueCount > 2);
      if (isDate) potentialTimeColumns.push(colName);

      // Check if it's a Metric
      const isMetricColName = /revenue|sales|profit|margin|cost|amount|volume|units|qty|quantity|sell_?out|valore|mrr|arr|price|total|stock|score/i.test(colName);
      const isMetric = dataType === 'number' && !isIdentifier && (isMetricColName || uniqueCount > 5);
      if (isMetric) potentialMetrics.push(colName);

      // Check if it's a Dimension
      const isDimension = (dataType === 'string' || dataType === 'boolean') && !isIdentifier && !isDate;
      if (isDimension) potentialDimensions.push(colName);

      // Infer Semantic Type
      let semanticType: ColumnProfile['semanticType'] = 'text';
      if (isIdentifier) {
        semanticType = 'identifier';
      } else if (isDate) {
        semanticType = 'date';
      } else if (/price|revenue|cost|valore|mrr|arr|amount/i.test(colName)) {
        semanticType = 'currency';
      } else if (/quantity|units|qty|volume|sell_?out|stock|count/i.test(colName)) {
        semanticType = 'quantity';
      } else if (/percent|pct|rate|share|margin|ratio/i.test(colName) || (dataType === 'number' && numValues.every(n => n >= 0 && n <= 1))) {
        semanticType = 'percentage';
      } else if (/region|country|city|state|territory|provincia|paese/i.test(colName)) {
        semanticType = 'region';
      } else if (dataType === 'boolean' || /status|flag|active|churn/i.test(colName)) {
        semanticType = 'boolean_flag';
      } else if (isDimension) {
        semanticType = 'category';
      }

      // Statistical calculations for numeric columns
      let min: unknown;
      let max: unknown;
      let mean: number | undefined;
      let median: number | undefined;
      let stdDev: number | undefined;

      if (numValues.length > 0) {
        numValues.sort((a, b) => a - b);
        min = numValues[0];
        max = numValues[numValues.length - 1];
        const sum = numValues.reduce((acc, curr) => acc + curr, 0);
        mean = Number((sum / numValues.length).toFixed(3));
        const mid = Math.floor(numValues.length / 2);
        median = numValues.length % 2 !== 0 ? numValues[mid] : Number(((numValues[mid - 1] + numValues[mid]) / 2).toFixed(3));
        
        // Variance and StdDev
        const variance = numValues.reduce((acc, curr) => acc + Math.pow(curr - (mean || 0), 2), 0) / numValues.length;
        stdDev = Number(Math.sqrt(variance).toFixed(3));
      } else if (distinctValues.size > 0) {
        const sorted = Array.from(distinctValues).sort();
        min = sorted[0];
        max = sorted[sorted.length - 1];
      }

      // Quality assessment
      if (nullRate > 0.3) {
        qualityIssues.push(`High null rate: ${(nullRate * 100).toFixed(1)}% missing values.`);
        totalQualityScoreDeductions += 10;
      }
      if (uniqueCount === 1 && rowCount > 1) {
        qualityIssues.push(`Constant column: all rows have value "${sampleValues[0]}".`);
        totalQualityScoreDeductions += 5;
      }
      if (numericCount > 0 && numericCount < validCount && dataType === 'number') {
        qualityIssues.push(`Mixed data types detected: contains non-numeric strings in numeric column.`);
        totalQualityScoreDeductions += 8;
      }

      columnProfiles.push({
        name: colName,
        dataType,
        semanticType,
        nullable: nullCount > 0,
        uniqueCount,
        nullRate,
        min,
        max,
        mean,
        median,
        stdDev,
        sampleValues,
        isIdentifier,
        isMetric,
        isDimension,
        isDate,
        confidence: 0.95,
        qualityIssues: qualityIssues.length > 0 ? qualityIssues : undefined,
      });
    }

    const overallQualityScore = Math.max(20, Math.min(100, 100 - totalQualityScoreDeductions - Math.round(duplicateRate * 50)));

    return {
      datasetId,
      versionId,
      sheetName,
      rowCount,
      columnCount,
      columns: columnProfiles,
      duplicateRowCount: duplicateRows,
      duplicateRate,
      overallQualityScore,
      potentialIdentifiers,
      potentialMetrics,
      potentialDimensions,
      potentialTimeColumns,
      profiledAt: new Date().toISOString(),
    };
  }
}
