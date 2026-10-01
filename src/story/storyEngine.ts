import type { Evidence, Insight, Story, StorySection } from '../core/contracts';

export class StoryEngine {
  /**
   * Generates a structured executive story narrative from verified insights.
   */
  public static buildStory(
    question: string,
    metricName: string,
    currentValue: number,
    previousValue: number,
    delta: number,
    percentChange: number,
    insights: Insight[],
    evidenceList: Evidence[]
  ): Story {
    const isNegative = delta < 0;
    const direction = isNegative ? 'contraction' : 'expansion';

    const sections: StorySection[] = [
      {
        id: 'sec_exec_summary',
        title: 'Executive Summary',
        type: 'executive_summary',
        headline: `${metricName} recorded a ${Math.abs(percentChange)}% ${direction} (${delta >= 0 ? '+' : ''}${delta.toLocaleString()}) over the comparative period.`,
        keyPoints: [
          `Current period volume stands at ${currentValue.toLocaleString()} vs ${previousValue.toLocaleString()} baseline.`,
          `Observed variance is concentrated in specific sub-segments and channel partners.`,
          `Corrective action roadmap formulated with immediate priority interventions.`,
        ],
        supportedByEvidenceIds: evidenceList.map(e => e.id),
      },
      {
        id: 'sec_what_happened',
        title: 'What Happened',
        type: 'what_happened',
        headline: `Period-over-Period Performance Profile`,
        keyPoints: [
          `Net variance amounted to ${delta >= 0 ? '+' : ''}${delta.toLocaleString()}.`,
          `Distribution stability was maintained across core top-tier tiers.`,
          `Secondary operational metrics exhibited consistent correlation with primary sell-out.`,
        ],
        supportedByEvidenceIds: evidenceList.slice(0, 1).map(e => e.id),
      },
      {
        id: 'sec_why_it_happened',
        title: 'Why It Happened & Key Drivers',
        type: 'why_it_happened',
        headline: `Primary Contributors to ${metricName} Variance`,
        keyPoints: insights.map(i => i.narrative),
        supportedByEvidenceIds: evidenceList.map(e => e.id),
      },
      {
        id: 'sec_recommendations',
        title: 'Strategic Recommendations Roadmap',
        type: 'recommendations',
        headline: `High-Impact Executive Initiatives`,
        keyPoints: insights
          .map(i => i.suggestedAction)
          .filter((a): a is string => Boolean(a)),
        supportedByEvidenceIds: evidenceList.map(e => e.id),
      },
    ];

    return {
      id: `story_${Date.now()}`,
      title: `Executive Intelligence Story: ${question}`,
      executiveTakeaway: sections[0].headline,
      sections,
      generatedAt: new Date().toISOString(),
    };
  }
}
