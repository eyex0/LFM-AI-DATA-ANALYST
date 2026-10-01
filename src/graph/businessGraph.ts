import type { BusinessGraph, GraphEdge, GraphNode, Insight } from '../core/contracts';

export class BusinessGraphEngine {
  /**
   * Constructs a structured Business Knowledge Graph linking entities, metrics, drivers, and actions.
   */
  public static generateFromAnalysis(
    metricName: string,
    metricValue: number | string,
    delta: number,
    percentChange: number,
    topDrivers: Array<{ name: string; delta: number; percentChange: number }>,
    insights: Insight[]
  ): BusinessGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const isNegative = delta < 0;
    const status = isNegative ? 'negative' : 'positive';

    // 1. Root Metric Node
    const rootId = `node_metric_${metricName.toLowerCase()}`;
    nodes.push({
      id: rootId,
      label: metricName.toUpperCase(),
      type: 'metric',
      data: {
        value: typeof metricValue === 'number' ? metricValue.toLocaleString() : metricValue,
        delta: `${percentChange >= 0 ? '+' : ''}${percentChange}% (${delta >= 0 ? '+' : ''}${delta.toLocaleString()})`,
        status,
        category: 'Core Business KPI',
      },
      position: { x: 300, y: 50 },
    });

    // 2. Driver Nodes (Level 1 children)
    const driverNodes = topDrivers.slice(0, 4);
    const startX = 60;
    const stepX = 180;

    driverNodes.forEach((d, idx) => {
      const driverId = `node_driver_${idx}_${d.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const driverStatus = d.delta < 0 ? 'negative' : 'positive';

      nodes.push({
        id: driverId,
        label: d.name,
        type: 'driver',
        data: {
          value: `${d.delta >= 0 ? '+' : ''}${d.delta.toLocaleString()}`,
          delta: `${d.percentChange >= 0 ? '+' : ''}${d.percentChange}%`,
          status: driverStatus,
          category: 'Key Driver Segment',
        },
        position: { x: startX + idx * stepX, y: 220 },
      });

      edges.push({
        id: `edge_${driverId}_to_${rootId}`,
        source: driverId,
        target: rootId,
        type: 'contributes_to',
        label: `${d.percentChange}% variance`,
        weight: Math.min(1, Math.abs(d.delta) / (Math.abs(delta) || 1)),
        animated: Math.abs(d.delta) > 0,
      });
    });

    // 3. Insight & Recommendation Nodes (Level 2 children)
    insights.slice(0, 2).forEach((ins, idx) => {
      const insNodeId = `node_insight_${idx}`;
      nodes.push({
        id: insNodeId,
        label: ins.title.slice(0, 36) + (ins.title.length > 36 ? '...' : ''),
        type: 'insight',
        data: {
          details: ins.narrative,
          status: ins.impact,
          category: 'Verified Insight',
        },
        position: { x: 120 + idx * 320, y: 380 },
      });

      // Link to root metric
      edges.push({
        id: `edge_${insNodeId}_to_${rootId}`,
        source: insNodeId,
        target: rootId,
        type: 'causes',
        label: 'explains',
      });

      // 4. Action Recommendation Node
      if (ins.suggestedAction) {
        const actionId = `node_action_${idx}`;
        nodes.push({
          id: actionId,
          label: `Strategic Action: ${ins.suggestedAction.slice(0, 32)}...`,
          type: 'action',
          data: {
            details: ins.suggestedAction,
            category: 'Executive Decision',
            status: 'neutral',
          },
          position: { x: 120 + idx * 320, y: 500 },
        });

        edges.push({
          id: `edge_${actionId}_to_${insNodeId}`,
          source: insNodeId,
          target: actionId,
          type: 'recommends',
          label: 'prescribes',
        });
      }
    });

    return {
      nodes,
      edges,
      rootMetricId: rootId,
    };
  }
}
