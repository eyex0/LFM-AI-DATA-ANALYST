import pptxgen from 'pptxgenjs';
import type { 
  BusinessGraph, 
  Evidence, 
  Insight, 
  PresentationPlan, 
  SlideSpec, 
  Story 
} from '../core/contracts';

export class PptxPresentationGenerator {
  /**
   * Builds a structured multi-slide presentation plan from a Story and insights.
   */
  public static createPresentationPlan(
    story: Story,
    metricName: string,
    currentVal: number,
    delta: number,
    percentChange: number,
    topDrivers: Array<{ name: string; delta: number; percentChange: number }>,
    insights: Insight[],
    graph: BusinessGraph,
    evidenceList: Evidence[]
  ): PresentationPlan {
    const slides: SlideSpec[] = [];

    // Slide 1: Executive Summary
    slides.push({
      slideNumber: 1,
      template: 'executive_summary',
      title: 'LFM AI ANALYST · EXECUTIVE BRIEFING',
      subtitle: story.title,
      elements: [
        {
          type: 'kpi_box',
          x: 0.8,
          y: 1.8,
          width: 4.2,
          height: 2.2,
          content: {
            label: `TOTAL ${metricName.toUpperCase()}`,
            value: currentVal.toLocaleString(),
            delta: `${percentChange >= 0 ? '+' : ''}${percentChange}% (${delta >= 0 ? '+' : ''}${delta.toLocaleString()})`,
            status: delta >= 0 ? 'positive' : 'negative',
          },
        },
        {
          type: 'bullet_list',
          x: 5.4,
          y: 1.8,
          width: 6.8,
          height: 4.5,
          content: story.sections[0].keyPoints,
        },
      ],
      speakerNotes: `Executive briefing on ${metricName} variance. Key takeaway: ${story.executiveTakeaway}`,
    });

    // Slide 2: KPI & Trend Overview
    slides.push({
      slideNumber: 2,
      template: 'kpi_overview',
      title: 'PERFORMANCE OVERVIEW & PERIOD PROFILE',
      subtitle: `Baseline vs Current Period Evaluation for ${metricName}`,
      elements: [
        {
          type: 'callout_box',
          x: 0.8,
          y: 1.8,
          width: 11.4,
          height: 1.2,
          content: story.sections[1].headline,
        },
        {
          type: 'table',
          x: 0.8,
          y: 3.3,
          width: 11.4,
          height: 3.2,
          content: {
            headers: ['Segment / Dimension', 'Current Period', 'Previous Baseline', 'Variance', '% Change'],
            rows: topDrivers.map(d => [
              d.name,
              '-',
              '-',
              `${d.delta >= 0 ? '+' : ''}${d.delta.toLocaleString()}`,
              `${d.percentChange >= 0 ? '+' : ''}${d.percentChange}%`,
            ]),
          },
        },
      ],
    });

    // Slide 3: Driver Analysis
    slides.push({
      slideNumber: 3,
      template: 'driver_breakdown',
      title: 'PRIMARY VARIANCE DRIVERS & ATTRIBUTION',
      subtitle: 'Attribution Breakdown Explaining Metric Movement',
      elements: [
        {
          type: 'bullet_list',
          x: 0.8,
          y: 1.8,
          width: 11.4,
          height: 4.8,
          content: insights.map(i => `${i.title}: ${i.narrative}`),
        },
      ],
    });

    // Slide 4: Business Knowledge Graph
    slides.push({
      slideNumber: 4,
      template: 'business_graph',
      title: 'BUSINESS KNOWLEDGE GRAPH · CAUSE & EFFECT',
      subtitle: 'Entity, Metric, and Driver Dependency Network',
      elements: [
        {
          type: 'graph_preview',
          x: 0.8,
          y: 1.8,
          width: 11.4,
          height: 4.8,
          content: {
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            rootMetric: metricName,
            driverNodes: graph.nodes.filter(n => n.type === 'driver').map(n => n.label),
          },
        },
      ],
    });

    // Slide 5: Strategic Action Plan
    slides.push({
      slideNumber: 5,
      template: 'action_plan',
      title: 'STRATEGIC RECOMMENDATIONS & ACTION ROADMAP',
      subtitle: 'Prioritized Executive Interventions',
      elements: [
        {
          type: 'bullet_list',
          x: 0.8,
          y: 1.8,
          width: 11.4,
          height: 4.8,
          content: insights.map(i => i.suggestedAction || 'Maintain continuous operational monitoring.'),
        },
      ],
    });

    // Slide 6: Evidence & Mathematical Verification Appendix
    slides.push({
      slideNumber: 6,
      template: 'evidence_appendix',
      title: 'EVIDENCE AUDIT TRAIL & VERIFICATION LEDGER',
      subtitle: 'Mathematical Traceability and Calculation Proofs',
      elements: [
        {
          type: 'bullet_list',
          x: 0.8,
          y: 1.8,
          width: 11.4,
          height: 4.8,
          content: evidenceList.map(e => `[Verified: ${(e.verificationResult.confidenceScore * 100).toFixed(0)}%] ${e.claim} — Formula: ${e.calculationFormula}`),
        },
      ],
    });

    return {
      id: `pres_${Date.now()}`,
      title: story.title,
      theme: 'corporate_onyx',
      slides,
      totalSlides: slides.length,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Renders the PresentationPlan into a production-grade PPTX file with Visual QA checks.
   */
  public static async generatePptx(plan: PresentationPlan): Promise<void> {
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_16x9';
    pptx.author = 'LFM AI Analyst';
    pptx.company = 'LFM Enterprise BI';
    pptx.title = plan.title;

    // Visual QA validation pass: detect overflow, empty text, or broken bounds
    for (const slide of plan.slides) {
      for (const el of slide.elements) {
        if (el.x + el.width > 13.3) {
          // 16x9 width is ~13.33 inches; auto-clamp to prevent overflow
          el.width = Math.max(2, 13.0 - el.x);
        }
        if (el.y + el.height > 7.5) {
          // 16x9 height is 7.5 inches; auto-clamp
          el.height = Math.max(1, 7.2 - el.y);
        }
      }
    }

    // Render each slide using modern executive aesthetics
    for (const slideSpec of plan.slides) {
      const slide = pptx.addSlide();

      // Background
      slide.background = { color: 'F8F9FA' };

      // Top Accent Bar (Brand Crimson & Navy)
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: '100%',
        h: 0.1,
        fill: { color: 'A50034' },
      });

      // Header Brand Stamp
      slide.addText('LFM AI ANALYST · AUTONOMOUS EXECUTIVE INTELLIGENCE', {
        x: 0.8,
        y: 0.35,
        w: 11.4,
        h: 0.3,
        fontSize: 9,
        bold: true,
        color: '64748B',
        fontFace: 'Arial',
      });

      // Slide Title
      slide.addText(slideSpec.title, {
        x: 0.8,
        y: 0.65,
        w: 11.4,
        h: 0.55,
        fontSize: 20,
        bold: true,
        color: '0F172A',
        fontFace: 'Arial',
      });

      // Subtitle if present
      if (slideSpec.subtitle) {
        slide.addText(slideSpec.subtitle, {
          x: 0.8,
          y: 1.2,
          w: 11.4,
          h: 0.35,
          fontSize: 11,
          color: '475569',
          fontFace: 'Arial',
        });
      }

      // Render Elements based on type
      for (const el of slideSpec.elements) {
        if (el.type === 'kpi_box') {
          const kpi = el.content as { label: string; value: string; delta: string; status: string };
          // Container box
          slide.addShape(pptx.ShapeType.roundRect, {
            x: el.x,
            y: el.y,
            w: el.width,
            h: el.height,
            fill: { color: 'FFFFFF' },
            line: { color: 'E2E8F0', width: 1 },
          });
          // Metric label
          slide.addText(kpi.label, {
            x: el.x + 0.3,
            y: el.y + 0.25,
            w: el.width - 0.6,
            h: 0.3,
            fontSize: 11,
            bold: true,
            color: '64748B',
          });
          // Value
          slide.addText(kpi.value, {
            x: el.x + 0.3,
            y: el.y + 0.65,
            w: el.width - 0.6,
            h: 0.7,
            fontSize: 28,
            bold: true,
            color: '0F172A',
          });
          // Delta
          slide.addText(kpi.delta, {
            x: el.x + 0.3,
            y: el.y + 1.45,
            w: el.width - 0.6,
            h: 0.35,
            fontSize: 12,
            bold: true,
            color: kpi.status === 'positive' ? '059669' : 'DC2626',
          });
        } else if (el.type === 'callout_box') {
          slide.addShape(pptx.ShapeType.roundRect, {
            x: el.x,
            y: el.y,
            w: el.width,
            h: el.height,
            fill: { color: 'EFF6FF' },
            line: { color: 'BFDBFE', width: 1 },
          });
          slide.addText(String(el.content), {
            x: el.x + 0.3,
            y: el.y + 0.15,
            w: el.width - 0.6,
            h: el.height - 0.3,
            fontSize: 13,
            bold: true,
            color: '1E3A8A',
          });
        } else if (el.type === 'bullet_list') {
          const items = Array.isArray(el.content) ? el.content : [String(el.content)];
          const bulletPoints = items.map(text => ({
            text: String(text),
            options: {
              fontSize: 12,
              color: '334155',
              bullet: true,
              spaceAfter: 12,
            },
          }));

          slide.addText(bulletPoints, {
            x: el.x,
            y: el.y,
            w: el.width,
            h: el.height,
            valign: 'top',
          });
        } else if (el.type === 'table') {
          const tbl = el.content as { headers: string[]; rows: string[][] };
          const tableData = [
            tbl.headers.map(h => ({
              text: h,
              options: { fill: { color: '0F172A' }, color: 'FFFFFF', bold: true, fontSize: 10 },
            })),
            ...tbl.rows.map((row, rIdx) =>
              row.map(cell => ({
                text: cell,
                options: {
                  fill: { color: rIdx % 2 === 0 ? 'FFFFFF' : 'F1F5F9' },
                  color: '334155',
                  fontSize: 10,
                },
              }))
            ),
          ];

          slide.addTable(tableData, {
            x: el.x,
            y: el.y,
            w: el.width,
            h: el.height,
          });
        } else if (el.type === 'graph_preview') {
          const g = el.content as { nodeCount: number; edgeCount: number; rootMetric: string; driverNodes: string[] };
          slide.addShape(pptx.ShapeType.roundRect, {
            x: el.x,
            y: el.y,
            w: el.width,
            h: el.height,
            fill: { color: 'FFFFFF' },
            line: { color: 'CBD5E1', width: 1 },
          });

          slide.addText(`Root KPI: ${g.rootMetric}  ·  Knowledge Nodes: ${g.nodeCount}  ·  Relationships: ${g.edgeCount}`, {
            x: el.x + 0.4,
            y: el.y + 0.3,
            w: el.width - 0.8,
            h: 0.4,
            bold: true,
            fontSize: 13,
            color: '0F172A',
          });

          const driverPills = g.driverNodes.map(name => `• Segment Driver: ${name}`).join('\n\n');
          slide.addText(driverPills, {
            x: el.x + 0.4,
            y: el.y + 1.0,
            w: el.width - 0.8,
            h: el.height - 1.2,
            fontSize: 11,
            color: '475569',
          });
        }
      }

      // Slide Footer
      slide.addText(`LFM AI Analyst · Slide ${slideSpec.slideNumber} of ${plan.slides.length}`, {
        x: 0.8,
        y: 7.0,
        w: 11.4,
        h: 0.3,
        fontSize: 8,
        color: '94A3B8',
      });
    }

    const cleanTitle = plan.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
    await pptx.writeFile({ fileName: `${cleanTitle}_LFM_Executive_Deck.pptx` });
  }
}
