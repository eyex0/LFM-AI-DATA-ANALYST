import * as XLSX from 'xlsx';
import type { 
  Connector, 
  ConnectorCapabilities, 
  ConnectorMetadata, 
  HealthStatus, 
  SchemaDefinition 
} from './connector';
import type { 
  DatasetColumn, 
  DataProfile, 
  QueryDefinition, 
  QueryResult, 
  SemanticRelationship 
} from '../core/contracts';
import { DataProfiler } from '../profiling/dataProfiler';

export interface InferredRelationship {
  fromSheet: string;
  fromColumn: string;
  toSheet: string;
  toColumn: string;
  relationshipType: 'one_to_one' | 'one_to_many' | 'many_to_one';
  confidence: number;
  inferredBy: 'automatic_inference';
}

export class ExcelConnector implements Connector {
  private workbook: XLSX.WorkBook;
  private fileName: string;
  private sheetData: Map<string, Record<string, unknown>[]> = new Map();
  private profiles: Map<string, DataProfile> = new Map();
  private relationships: InferredRelationship[] = [];

  constructor(fileBuffer: ArrayBuffer | Buffer, fileName: string) {
    this.fileName = fileName;
    this.workbook = XLSX.read(fileBuffer, {
      type: fileBuffer instanceof Buffer ? 'buffer' : 'array',
      cellDates: true,
      dateNF: 'yyyy-mm-dd',
    });

    this.parseAllSheets();
    this.discoverRelationships();
  }

  public getSheetNames(): string[] {
    return this.workbook.SheetNames || [];
  }

  public getSheetRows(sheetName: string): Record<string, unknown>[] {
    return this.sheetData.get(sheetName) || [];
  }

  public getInferredRelationships(): InferredRelationship[] {
    return this.relationships;
  }

  private parseAllSheets(): void {
    const sheetNames = this.workbook.SheetNames || [];
    for (const sheetName of sheetNames) {
      const worksheet = this.workbook.Sheets[sheetName];
      if (!worksheet) continue;

      // Extract raw JSON rows, trimming empty rows and headers
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: null,
        blankrows: false,
      });

      if (rawRows.length > 0) {
        // Clean column names (strip whitespace, ensure unique names)
        const cleanedRows: Record<string, unknown>[] = rawRows.map(row => {
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            const cleanKey = k.trim().replace(/\s+/g, '_');
            cleaned[cleanKey] = v;
          }
          return cleaned;
        });

        this.sheetData.set(sheetName, cleanedRows);
      }
    }
  }

  private discoverRelationships(): void {
    const sheets = Array.from(this.sheetData.keys());
    if (sheets.length < 2) return;

    for (let i = 0; i < sheets.length; i++) {
      for (let j = 0; j < sheets.length; j++) {
        if (i === j) continue;
        const sheetA = sheets[i];
        const sheetB = sheets[j];
        const rowsA = this.sheetData.get(sheetA) || [];
        const rowsB = this.sheetData.get(sheetB) || [];

        if (rowsA.length === 0 || rowsB.length === 0) continue;

        const colsA = Object.keys(rowsA[0]);
        const colsB = Object.keys(rowsB[0]);

        for (const colA of colsA) {
          for (const colB of colsB) {
            const cleanA = colA.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanB = colB.toLowerCase().replace(/[^a-z0-9]/g, '');

            // Check name matches, e.g. customer_id vs customer_id or id in Customer vs customer_id in Orders
            let nameSimilarity = 0;
            if (cleanA === cleanB) {
              nameSimilarity = 0.9;
            } else if (cleanA.endsWith(cleanB) || cleanB.endsWith(cleanA)) {
              nameSimilarity = 0.75;
            } else if (
              (cleanA.includes('id') && cleanB.includes('id') && cleanA.includes(sheetB.toLowerCase().slice(0, 4))) ||
              (cleanB.includes('id') && cleanA.includes('id') && cleanB.includes(sheetA.toLowerCase().slice(0, 4)))
            ) {
              nameSimilarity = 0.85;
            }

            if (nameSimilarity > 0.6) {
              // Value overlap testing (test up to 50 sample values)
              const valsA = new Set(rowsA.slice(0, 100).map(r => String(r[colA] || '')).filter(Boolean));
              const valsB = new Set(rowsB.slice(0, 100).map(r => String(r[colB] || '')).filter(Boolean));

              let overlapCount = 0;
              for (const v of valsA) {
                if (valsB.has(v)) overlapCount++;
              }

              const overlapRatio = valsA.size > 0 ? overlapCount / valsA.size : 0;
              const totalConfidence = Number((nameSimilarity * 0.5 + overlapRatio * 0.5).toFixed(2));

              if (totalConfidence >= 0.65) {
                this.relationships.push({
                  fromSheet: sheetA,
                  fromColumn: colA,
                  toSheet: sheetB,
                  toColumn: colB,
                  relationshipType: 'many_to_one',
                  confidence: totalConfidence,
                  inferredBy: 'automatic_inference',
                });
              }
            }
          }
        }
      }
    }
  }

  async discoverSchema(): Promise<SchemaDefinition> {
    const sheetNames = this.getSheetNames();
    const primarySheet = sheetNames[0] || 'Sheet1';
    const rows = this.getSheetRows(primarySheet);

    const columns: DatasetColumn[] = rows.length > 0
      ? Object.keys(rows[0]).map((colName, idx) => ({
          name: colName,
          originalName: colName,
          dataType: 'string', // detailed by profiler
          nullable: true,
          ordinalPosition: idx + 1,
        }))
      : [];

    return {
      tableName: primarySheet,
      columns,
      sheets: sheetNames,
      totalEstimatedRows: rows.length,
    };
  }

  async profile(): Promise<DataProfile> {
    const primarySheet = this.getSheetNames()[0] || 'Sheet1';
    if (this.profiles.has(primarySheet)) {
      return this.profiles.get(primarySheet)!;
    }

    const rows = this.getSheetRows(primarySheet);
    const profile = DataProfiler.profileTable(rows, this.fileName, 'v1', primarySheet);
    this.profiles.set(primarySheet, profile);
    return profile;
  }

  public profileSheet(sheetName: string): DataProfile {
    if (this.profiles.has(sheetName)) {
      return this.profiles.get(sheetName)!;
    }
    const rows = this.getSheetRows(sheetName);
    const profile = DataProfiler.profileTable(rows, this.fileName, 'v1', sheetName);
    this.profiles.set(sheetName, profile);
    return profile;
  }

  async executeQuery(query: QueryDefinition): Promise<QueryResult> {
    const sheetName = query.entityName || this.getSheetNames()[0] || 'Sheet1';
    const rows = this.getSheetRows(sheetName);
    const startTime = performance.now();

    // In-memory query execution
    let filtered = [...rows];

    // 1. Apply Filters
    if (query.filters && query.filters.length > 0) {
      for (const f of query.filters) {
        filtered = filtered.filter(row => {
          const val = row[f.column];
          switch (f.operator) {
            case 'eq': return String(val) === String(f.value);
            case 'neq': return String(val) !== String(f.value);
            case 'gt': return Number(val) > Number(f.value);
            case 'gte': return Number(val) >= Number(f.value);
            case 'lt': return Number(val) < Number(f.value);
            case 'lte': return Number(val) <= Number(f.value);
            case 'in': return Array.isArray(f.value) && f.value.includes(val);
            case 'like': return String(val).toLowerCase().includes(String(f.value).toLowerCase());
            default: return true;
          }
        });
      }
    }

    // 2. Grouping & Aggregations
    let resultRows: Record<string, unknown>[] = [];
    const hasDimensions = query.dimensions && query.dimensions.length > 0;
    const hasMeasures = query.measures && query.measures.length > 0;

    if (hasDimensions) {
      const groups = new Map<string, { groupKeys: Record<string, unknown>; rows: Record<string, unknown>[] }>();

      filtered.forEach(row => {
        const keyParts = query.dimensions.map(d => String(row[d.column] ?? 'Unknown'));
        const groupKey = keyParts.join('___');

        if (!groups.has(groupKey)) {
          const groupKeys: Record<string, unknown> = {};
          query.dimensions.forEach(d => {
            groupKeys[d.alias || d.column] = row[d.column];
          });
          groups.set(groupKey, { groupKeys, rows: [] });
        }
        groups.get(groupKey)!.rows.push(row);
      });

      groups.forEach(({ groupKeys, rows: gRows }) => {
        const outRow: Record<string, unknown> = { ...groupKeys };

        if (hasMeasures) {
          query.measures.forEach(m => {
            const values = gRows
              .map(r => {
                const raw = r[m.column];
                if (typeof raw === 'number') return raw;
                const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
                return isNaN(num) ? 0 : num;
              });

            let aggVal = 0;
            if (m.aggregation === 'sum') {
              aggVal = values.reduce((a, b) => a + b, 0);
            } else if (m.aggregation === 'avg') {
              aggVal = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            } else if (m.aggregation === 'count') {
              aggVal = gRows.length;
            } else if (m.aggregation === 'min') {
              aggVal = Math.min(...values);
            } else if (m.aggregation === 'max') {
              aggVal = Math.max(...values);
            } else if (m.aggregation === 'distinct_count') {
              aggVal = new Set(gRows.map(r => String(r[m.column]))).size;
            }

            outRow[m.alias] = Number(aggVal.toFixed(2));
          });
        }
        resultRows.push(outRow);
      });
    } else if (hasMeasures) {
      // Grand Total
      const outRow: Record<string, unknown> = {};
      query.measures.forEach(m => {
        const values = filtered.map(r => {
          const raw = r[m.column];
          if (typeof raw === 'number') return raw;
          const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
          return isNaN(num) ? 0 : num;
        });

        let aggVal = 0;
        if (m.aggregation === 'sum') aggVal = values.reduce((a, b) => a + b, 0);
        else if (m.aggregation === 'avg') aggVal = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        else if (m.aggregation === 'count') aggVal = filtered.length;
        else if (m.aggregation === 'min') aggVal = Math.min(...values);
        else if (m.aggregation === 'max') aggVal = Math.max(...values);
        outRow[m.alias] = Number(aggVal.toFixed(2));
      });
      resultRows.push(outRow);
    } else {
      resultRows = filtered.slice(0, query.limit || 100);
    }

    // 3. Ordering
    if (query.orderBy && query.orderBy.length > 0) {
      const order = query.orderBy[0];
      resultRows.sort((a, b) => {
        const valA = a[order.column];
        const valB = b[order.column];
        if (typeof valA === 'number' && typeof valB === 'number') {
          return order.direction === 'asc' ? valA - valB : valB - valA;
        }
        return order.direction === 'asc' 
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
    }

    // 4. Limit
    if (query.limit && query.limit > 0) {
      resultRows = resultRows.slice(0, query.limit);
    }

    const duration = performance.now() - startTime;
    const columns = resultRows.length > 0 ? Object.keys(resultRows[0]) : [];

    return {
      columns,
      rows: resultRows,
      totalRows: resultRows.length,
      executionTimeMs: Math.round(duration),
      queryId: query.id,
      verified: true,
    };
  }

  async getMetadata(): Promise<ConnectorMetadata> {
    return {
      sourceType: 'excel',
      name: 'Universal Excel SheetJS Connector',
      version: '1.0.0',
      sourceIdentifier: this.fileName,
      connectionState: 'connected',
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: true,
      latencyMs: 1,
      timestamp: new Date().toISOString(),
    };
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportsMultiSheet: true,
      supportsStreaming: false,
      supportsCustomSQL: false,
      supportsSchemaDiscovery: true,
      supportsRealTimeSync: false,
      maxRecommendedRows: 150000,
    };
  }
}
