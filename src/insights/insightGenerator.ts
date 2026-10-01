import type { Evidence, Insight } from '../core/contracts';

export class InsightGenerator {
  /**
   * Constructs verified insights attached to rigorous mathematical evidence.
   */
  public static generateDriverInsight(
    metricName: string,
    topDriverName: string,
    driverContributionPct: number,
    driverDelta: number,
    overallDelta: number,
    evidence: Evidence
  ): Insight {
    const isNegative = overallDelta < 0;
    const direction = isNegative ? 'decline' : 'growth';
    const driverDirection = driverDelta < 0 ? 'contraction' : 'expansion';

    return {
      id: `ins_${Math.random().toString(36).substring(2, 9)}`,
      type: 'driver',
      title: `${topDriverName} accounts for ${Math.abs(driverContributionPct)}% of total ${direction}`,
      narrative: `Analysis of ${metricName} shows an overall ${direction} of ${Math.abs(overallDelta).toLocaleString()}. The primary driver is ${topDriverName} experiencing a ${driverDirection} of ${Math.abs(driverDelta).toLocaleString()}, which explains ${Math.abs(driverContributionPct)}% of the total variance.`,
      impact: isNegative ? 'negative' : 'positive',
      impactMagnitude: driverContributionPct,
      evidence,
      suggestedAction: isNegative
        ? `Deploy recovery interventions focused on ${topDriverName} to mitigate further volume erosion.`
        : `Scale successful practices from ${topDriverName} across other operational segments.`,
    };
  }

  public static generateTrendInsight(
    metricName: string,
    percentChange: number,
    currentValue: number,
    previousValue: number,
    evidence: Evidence
  ): Insight {
    const isGrowth = percentChange >= 0;
    return {
      id: `ins_trend_${Math.random().toString(36).substring(2, 9)}`,
      type: 'trend',
      title: `${metricName} ${isGrowth ? 'increased' : 'decreased'} by ${Math.abs(percentChange)}% period-over-period`,
      narrative: `Aggregated ${metricName} shifted from ${previousValue.toLocaleString()} in the baseline period to ${currentValue.toLocaleString()} in the current evaluation period (${percentChange >= 0 ? '+' : ''}${percentChange}%).`,
      impact: isGrowth ? 'positive' : 'negative',
      impactMagnitude: percentChange,
      evidence,
      suggestedAction: isGrowth 
        ? `Consolidate momentum by reinforcing primary supply and distribution channels.` 
        : `Conduct diagnostic deep dive into regional and account-level sub-segments.`,
    };
  }
}
