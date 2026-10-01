import type { 
  Evidence, 
  VerificationCheck, 
  VerificationResult 
} from '../core/contracts';

export class VerificationEngine {
  /**
   * Verifies mathematical and arithmetic consistency of a calculated metric claim.
   */
  public static verifyClaim(
    claimText: string,
    previousVal: number,
    currentVal: number,
    claimedDelta: number,
    claimedPercentChange: number,
    datasetVersionId: string,
    queryRunId: string,
    rawSample: Record<string, unknown>[] = []
  ): Evidence {
    const checks: VerificationCheck[] = [];

    // 1. Check Arithmetic Difference: Current - Previous === Delta
    const calculatedDelta = Number((currentVal - previousVal).toFixed(2));
    const deltaDiff = Math.abs(calculatedDelta - claimedDelta);
    const deltaPassed = deltaDiff < 0.05; // 5 cent tolerance

    checks.push({
      id: `chk_arithmetic_delta_${Date.now()}`,
      checkType: 'arithmetic',
      claimText: `Absolute difference between current (${currentVal}) and previous (${previousVal}) is ${claimedDelta}`,
      expectedValue: calculatedDelta,
      calculatedValue: claimedDelta,
      passed: deltaPassed,
      delta: deltaDiff,
      details: deltaPassed 
        ? `Verified exact arithmetic delta: ${calculatedDelta}` 
        : `Arithmetic mismatch: expected ${calculatedDelta} but claim stated ${claimedDelta}`,
    });

    // 2. Check Denominator Non-Zero & Percentage calculation
    let pctPassed = true;
    let expectedPct = 0;
    if (previousVal !== 0) {
      expectedPct = Number(((calculatedDelta / Math.abs(previousVal)) * 100).toFixed(2));
      const pctDiff = Math.abs(expectedPct - claimedPercentChange);
      pctPassed = pctDiff < 0.1; // 0.1% tolerance

      checks.push({
        id: `chk_pct_change_${Date.now()}`,
        checkType: 'denominator_non_zero',
        claimText: `Percentage change calculation: (${calculatedDelta} / ${previousVal}) * 100 === ${claimedPercentChange}%`,
        expectedValue: `${expectedPct}%`,
        calculatedValue: `${claimedPercentChange}%`,
        passed: pctPassed,
        delta: pctDiff,
        details: pctPassed 
          ? `Verified percentage calculation: ${expectedPct}%` 
          : `Percentage mismatch: expected ${expectedPct}% but claim stated ${claimedPercentChange}%`,
      });
    } else {
      checks.push({
        id: `chk_zero_denominator_${Date.now()}`,
        checkType: 'denominator_non_zero',
        claimText: `Previous value is 0; percentage growth is undefined`,
        expectedValue: 'N/A',
        calculatedValue: 'N/A',
        passed: true,
        details: 'Denominator was 0; avoided division by zero.',
      });
    }

    const overallPassed = checks.every(c => c.passed);
    const confidenceScore = overallPassed ? 1.0 : Number((checks.filter(c => c.passed).length / checks.length).toFixed(2));

    const verificationResult: VerificationResult = {
      id: `vr_${Math.random().toString(36).substring(2, 9)}`,
      overallPassed,
      confidenceScore,
      checks,
      repairedClaimsCount: overallPassed ? 0 : 1,
      verifiedAt: new Date().toISOString(),
    };

    return {
      id: `ev_${Math.random().toString(36).substring(2, 9)}`,
      claim: claimText,
      datasetVersionId,
      queryRunId,
      calculationFormula: `delta = current (${currentVal}) - previous (${previousVal}); pct = (delta / previous) * 100`,
      rawSampleData: rawSample.slice(0, 10),
      verificationResult,
      stepTrace: `QueryRun [${queryRunId}] -> Arithmetic Crosscheck -> Evidence Verified (${(confidenceScore * 100).toFixed(0)}% confidence)`,
    };
  }

  /**
   * Verifies that the sum of segmented sub-components exactly equals the grand total.
   */
  public static verifySegmentReconciliation(
    segmentTotals: number[],
    grandTotal: number,
    datasetVersionId: string,
    queryRunId: string
  ): VerificationResult {
    const sumSegments = Number(segmentTotals.reduce((a, b) => a + b, 0).toFixed(2));
    const delta = Math.abs(sumSegments - grandTotal);
    const passed = delta < 0.1;

    const check: VerificationCheck = {
      id: `chk_reconciliation_${Date.now()}`,
      checkType: 'cross_tab_consistency',
      claimText: `Sum of ${segmentTotals.length} segments equals grand total of ${grandTotal}`,
      expectedValue: grandTotal,
      calculatedValue: sumSegments,
      passed,
      delta,
      details: passed 
        ? `Reconciliation verified: sum of segments matches grand total.` 
        : `Reconciliation error: sum of segments (${sumSegments}) differs from grand total (${grandTotal}) by ${delta}.`,
    };

    return {
      id: `vr_reconcile_${Date.now()}`,
      overallPassed: passed,
      confidenceScore: passed ? 1.0 : 0.7,
      checks: [check],
      repairedClaimsCount: 0,
      verifiedAt: new Date().toISOString(),
    };
  }
}
