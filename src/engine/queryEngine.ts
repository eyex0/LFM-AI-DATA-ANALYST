import type { 
  QueryDefinition, 
  QueryResult, 
  SemanticModel 
} from '../core/contracts';

export interface QueryValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedQuery?: QueryDefinition;
}

export class AnalyticalQueryEngine {
  /**
   * Validates a QueryDefinition against a SemanticModel to ensure safety and integrity.
   */
  public static validateQuery(query: QueryDefinition, semanticModel: SemanticModel): QueryValidationResult {
    const errors: string[] = [];

    // Ensure valid measures
    if (query.measures && query.measures.length > 0) {
      for (const m of query.measures) {
        const allowedAggs = ['sum', 'avg', 'count', 'min', 'max', 'distinct_count'];
        if (!allowedAggs.includes(m.aggregation)) {
          errors.push(`Invalid aggregation [${m.aggregation}] on measure ${m.column}. Allowed: ${allowedAggs.join(', ')}`);
        }
      }
    }

    // Ensure dimensions are not SQL injections
    if (query.dimensions) {
      for (const d of query.dimensions) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(d.column)) {
          errors.push(`Invalid column name characters in dimension: ${d.column}`);
        }
      }
    }

    // Limit safety
    const safeLimit = Math.min(Math.max(1, query.limit || 500), 5000);

    return {
      valid: errors.length === 0,
      errors,
      sanitizedQuery: {
        ...query,
        limit: safeLimit,
      },
    };
  }

  /**
   * Executes a period comparison query (e.g. Current vs Previous period variance).
   */
  public static computePeriodComparison(
    rows: Record<string, unknown>[],
    metricCol: string,
    timeCol: string,
    dimensionCol?: string
  ): {
    currentTotal: number;
    previousTotal: number;
    delta: number;
    percentChange: number;
    breakdown: Array<{
      dimension: string;
      current: number;
      previous: number;
      delta: number;
      percentChange: number;
    }>;
  } {
    // Sort unique time periods
    const periods = Array.from(new Set(rows.map(r => String(r[timeCol] || '')).filter(Boolean))).sort();
    if (periods.length < 2) {
      const sum = rows.reduce((acc, r) => acc + (Number(r[metricCol]) || 0), 0);
      return {
        currentTotal: sum,
        previousTotal: sum,
        delta: 0,
        percentChange: 0,
        breakdown: [],
      };
    }

    const mid = Math.floor(periods.length / 2);
    const prevPeriods = new Set(periods.slice(0, mid));
    const currPeriods = new Set(periods.slice(mid));

    let currentTotal = 0;
    let previousTotal = 0;

    const breakdownMap = new Map<string, { current: number; previous: number }>();

    rows.forEach(r => {
      const p = String(r[timeCol] || '');
      const val = typeof r[metricCol] === 'number' ? r[metricCol] as number : parseFloat(String(r[metricCol] || '0').replace(/[^0-9.-]/g, '')) || 0;
      const dim = dimensionCol ? String(r[dimensionCol] || 'Other') : 'Total';

      if (!breakdownMap.has(dim)) {
        breakdownMap.set(dim, { current: 0, previous: 0 });
      }

      if (currPeriods.has(p)) {
        currentTotal += val;
        breakdownMap.get(dim)!.current += val;
      } else if (prevPeriods.has(p)) {
        previousTotal += val;
        breakdownMap.get(dim)!.previous += val;
      }
    });

    const delta = Number((currentTotal - previousTotal).toFixed(2));
    const percentChange = previousTotal !== 0 
      ? Number(((delta / previousTotal) * 100).toFixed(2)) 
      : 0;

    const breakdown = Array.from(breakdownMap.entries()).map(([dimension, { current, previous }]) => {
      const d = Number((current - previous).toFixed(2));
      const pct = previous !== 0 ? Number(((d / previous) * 100).toFixed(2)) : 0;
      return {
        dimension,
        current: Number(current.toFixed(2)),
        previous: Number(previous.toFixed(2)),
        delta: d,
        percentChange: pct,
      };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return {
      currentTotal: Number(currentTotal.toFixed(2)),
      previousTotal: Number(previousTotal.toFixed(2)),
      delta,
      percentChange,
      breakdown,
    };
  }
}
