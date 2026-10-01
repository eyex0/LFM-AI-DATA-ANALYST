import type { 
  DataProfile, 
  SemanticDimension, 
  SemanticEntity, 
  SemanticMetric, 
  SemanticModel, 
  SemanticRelationship,
  BusinessRule
} from '../core/contracts';

export class SemanticModelBuilder {
  /**
   * Automatically infers a complete, strongly-typed SemanticModel from a DataProfile.
   */
  public static buildFromProfile(
    profile: DataProfile, 
    workspaceId: string = 'ws_default_analytics',
    inferredRelationships: SemanticRelationship[] = []
  ): SemanticModel {
    const entityName = profile.sheetName || 'PrimaryData';
    const primaryKeys = profile.potentialIdentifiers.length > 0 
      ? [profile.potentialIdentifiers[0]] 
      : ['row_id'];

    const entity: SemanticEntity = {
      id: `ent_${entityName.toLowerCase()}`,
      name: entityName,
      displayName: entityName.replace(/_/g, ' '),
      description: `Primary data entity inferred from ${profile.sheetName || 'dataset'} with ${profile.rowCount} records`,
      primaryKey: primaryKeys,
      tableName: entityName,
    };

    const metrics: SemanticMetric[] = [];
    const dimensions: SemanticDimension[] = [];
    const businessRules: BusinessRule[] = [];

    for (const col of profile.columns) {
      if (col.isMetric) {
        let aggregation: SemanticMetric['aggregation'] = 'sum';
        let format: SemanticMetric['format'] = 'decimal';
        let unit: string | undefined = undefined;

        if (col.semanticType === 'currency') {
          format = 'currency';
          unit = '€';
          aggregation = 'sum';
        } else if (col.semanticType === 'percentage') {
          format = 'percentage';
          unit = '%';
          aggregation = 'avg';
        } else if (col.semanticType === 'quantity') {
          format = 'integer';
          unit = 'units';
          aggregation = 'sum';
        }

        const isDefault = col.name === profile.potentialMetrics[0];

        metrics.push({
          id: `metric_${col.name.toLowerCase()}`,
          name: col.name,
          displayName: col.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: `Calculated aggregate of ${col.name} (min: ${col.min}, max: ${col.max}, mean: ${col.mean})`,
          entityName: entity.name,
          columnName: col.name,
          aggregation,
          unit,
          format,
          isDefaultTarget: isDefault,
        });

        // Generate baseline business rule / threshold
        if (col.mean !== undefined && col.min !== undefined && col.max !== undefined) {
          businessRules.push({
            id: `rule_${col.name.toLowerCase()}_anom`,
            name: `${col.name} Anomaly Threshold`,
            description: `Flag records where ${col.name} falls outside normal expected range`,
            targetMetric: col.name,
            targetEntity: entity.name,
            threshold: col.mean * 0.25,
            priority: 'high',
          });
        }
      } else if (col.isDimension) {
        let dimType: SemanticDimension['dimensionType'] = 'categorical';
        if (col.semanticType === 'region') dimType = 'geographic';
        else if (col.isDate) dimType = 'time';

        dimensions.push({
          id: `dim_${col.name.toLowerCase()}`,
          name: col.name,
          displayName: col.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: `Categorical dimension ${col.name} with ${col.uniqueCount} distinct values`,
          entityName: entity.name,
          columnName: col.name,
          dimensionType: dimType,
          cardinality: col.uniqueCount,
        });
      } else if (col.isDate) {
        dimensions.push({
          id: `dim_time_${col.name.toLowerCase()}`,
          name: col.name,
          displayName: `${col.name.replace(/_/g, ' ')} (Timeline)`,
          description: `Time dimension for trend analysis and period comparisons`,
          entityName: entity.name,
          columnName: col.name,
          dimensionType: 'time',
          cardinality: col.uniqueCount,
        });
      }
    }

    return {
      id: `sm_${profile.datasetId}_${profile.versionId}`,
      workspaceId,
      datasetVersionId: profile.versionId,
      name: `${profile.sheetName || 'Enterprise'} Semantic Model`,
      description: `Governed semantic model with ${metrics.length} metrics, ${dimensions.length} dimensions, and ${inferredRelationships.length} relationships`,
      entities: [entity],
      metrics,
      dimensions,
      relationships: inferredRelationships,
      businessRules,
      createdAt: new Date().toISOString(),
    };
  }
}
