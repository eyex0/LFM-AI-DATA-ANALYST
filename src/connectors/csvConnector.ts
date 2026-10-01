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
  QueryResult 
} from '../core/contracts';
import { DataProfiler } from '../profiling/dataProfiler';

export class CsvConnector implements Connector {
  private fileName: string;
  private rows: Record<string, unknown>[] = [];
  private profileCache?: DataProfile;

  constructor(csvContent: string, fileName: string) {
    this.fileName = fileName;
    this.parseCsv(csvContent);
  }

  private parseCsv(content: string): void {
    const workbook = XLSX.read(content, { type: 'string' });
    const firstSheetName = workbook.SheetNames[0] || 'Sheet1';
    const worksheet = workbook.Sheets[firstSheetName];
    if (worksheet) {
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: null,
        blankrows: false,
      });

      this.rows = rawRows.map(row => {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          cleaned[k.trim().replace(/\s+/g, '_')] = v;
        }
        return cleaned;
      });
    }
  }

  public getRows(): Record<string, unknown>[] {
    return this.rows;
  }

  async discoverSchema(): Promise<SchemaDefinition> {
    const columns: DatasetColumn[] = this.rows.length > 0
      ? Object.keys(this.rows[0]).map((colName, idx) => ({
          name: colName,
          originalName: colName,
          dataType: 'string',
          nullable: true,
          ordinalPosition: idx + 1,
        }))
      : [];

    return {
      tableName: this.fileName.replace(/\.csv$/i, ''),
      columns,
      totalEstimatedRows: this.rows.length,
    };
  }

  async profile(): Promise<DataProfile> {
    if (!this.profileCache) {
      this.profileCache = DataProfiler.profileTable(this.rows, this.fileName, 'v1');
    }
    return this.profileCache;
  }

  async executeQuery(query: QueryDefinition): Promise<QueryResult> {
    const startTime = performance.now();
    let filtered = [...this.rows];

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
            const values = gRows.map(r => {
              const raw = r[m.column];
              if (typeof raw === 'number') return raw;
              const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
              return isNaN(num) ? 0 : num;
            });

            let aggVal = 0;
            if (m.aggregation === 'sum') aggVal = values.reduce((a, b) => a + b, 0);
            else if (m.aggregation === 'avg') aggVal = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            else if (m.aggregation === 'count') aggVal = gRows.length;
            else if (m.aggregation === 'min') aggVal = Math.min(...values);
            else if (m.aggregation === 'max') aggVal = Math.max(...values);
            else if (m.aggregation === 'distinct_count') aggVal = new Set(gRows.map(r => String(r[m.column]))).size;

            outRow[m.alias] = Number(aggVal.toFixed(2));
          });
        }
        resultRows.push(outRow);
      });
    } else if (hasMeasures) {
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
        outRow[m.alias] = Number(aggVal.toFixed(2));
      });
      resultRows.push(outRow);
    } else {
      resultRows = filtered.slice(0, query.limit || 100);
    }

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
      sourceType: 'csv',
      name: 'Delimited CSV Connector',
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
      supportsMultiSheet: false,
      supportsStreaming: false,
      supportsCustomSQL: false,
      supportsSchemaDiscovery: true,
      supportsRealTimeSync: false,
      maxRecommendedRows: 250000,
    };
  }
}
