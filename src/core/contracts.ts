/**
 * Core Domain Contracts
 * These contracts are independent of React, Express, PostgreSQL, Excel, ECharts, or LLM providers.
 */

// ==========================================
// 1. Tenancy Contracts
// ==========================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: 'admin' | 'analyst' | 'viewer';
}

export interface TenancyContext {
  organizationId: string;
  workspaceId: string;
  userId: string;
}

// ==========================================
// 2. Dataset & Profiling Contracts
// ==========================================

export type SupportedSourceType = 'excel' | 'csv' | 'postgres' | 'snowflake' | 'bigquery';

export interface Dataset {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  sourceType: SupportedSourceType;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetColumn {
  name: string;
  originalName: string;
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'unknown';
  nullable: boolean;
  ordinalPosition: number;
}

export interface ColumnProfile {
  name: string;
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'unknown';
  semanticType?: 'identifier' | 'currency' | 'quantity' | 'percentage' | 'rate' | 'category' | 'date' | 'region' | 'boolean_flag' | 'text';
  nullable: boolean;
  uniqueCount: number;
  nullRate: number;
  min?: unknown;
  max?: unknown;
  mean?: number;
  median?: number;
  stdDev?: number;
  sampleValues: unknown[];
  isIdentifier: boolean;
  isMetric: boolean;
  isDimension: boolean;
  isDate: boolean;
  confidence: number;
  qualityIssues?: string[];
}

export interface DataProfile {
  datasetId: string;
  versionId: string;
  sheetName?: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  duplicateRowCount: number;
  duplicateRate: number;
  overallQualityScore: number; // 0-100
  potentialIdentifiers: string[];
  potentialMetrics: string[];
  potentialDimensions: string[];
  potentialTimeColumns: string[];
  profiledAt: string;
}

export interface DatasetVersion {
  id: string;
  datasetId: string;
  versionNumber: number;
  sourceFileName: string;
  sourceType: SupportedSourceType;
  sheetNames: string[];
  activeSheetName?: string;
  storageReference: string;
  checksum: string;
  sizeBytes: number;
  schema: DatasetColumn[];
  profile?: DataProfile;
  createdAt: string;
}

// ==========================================
// 3. Semantic Layer Contracts
// ==========================================

export interface SemanticEntity {
  id: string;
  name: string;
  displayName: string;
  description: string;
  primaryKey: string[];
  tableName: string;
}

export interface SemanticMetric {
  id: string;
  name: string;
  displayName: string;
  description: string;
  entityName: string;
  columnName: string;
  aggregation: 'sum' | 'avg' | 'count' | 'distinct_count' | 'min' | 'max' | 'custom_formula';
  unit?: string;
  format?: 'currency' | 'integer' | 'decimal' | 'percentage';
  formula?: string;
  isDefaultTarget?: boolean;
}

export interface SemanticDimension {
  id: string;
  name: string;
  displayName: string;
  description: string;
  entityName: string;
  columnName: string;
  dimensionType: 'categorical' | 'time' | 'geographic' | 'hierarchical';
  cardinality: number;
  hierarchyLevel?: number;
  parentDimension?: string;
}

export interface SemanticRelationship {
  id: string;
  fromEntity: string;
  fromColumn: string;
  toEntity: string;
  toColumn: string;
  relationshipType: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  confidence: number;
  inferredBy: 'automatic_inference' | 'user_defined' | 'schema_foreign_key';
  confirmed: boolean;
}

export interface BusinessRule {
  id: string;
  name: string;
  description: string;
  targetMetric?: string;
  targetEntity?: string;
  conditionFormula?: string;
  threshold?: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface SemanticModel {
  id: string;
  workspaceId: string;
  datasetVersionId: string;
  name: string;
  description: string;
  entities: SemanticEntity[];
  metrics: SemanticMetric[];
  dimensions: SemanticDimension[];
  relationships: SemanticRelationship[];
  businessRules: BusinessRule[];
  createdAt: string;
}

// ==========================================
// 4. Query & Analytics Contracts
// ==========================================

export interface QueryFilter {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between' | 'like';
  value: unknown;
}

export interface QueryDefinition {
  id: string;
  entityName?: string;
  measures: Array<{
    column: string;
    aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'distinct_count';
    alias: string;
  }>;
  dimensions: Array<{
    column: string;
    alias?: string;
    timeBucket?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  }>;
  filters?: QueryFilter[];
  orderBy?: Array<{
    column: string;
    direction: 'asc' | 'desc';
  }>;
  limit?: number;
  periodComparison?: {
    timeColumn: string;
    currentPeriod: { start: string; end: string };
    previousPeriod: { start: string; end: string };
  };
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  executionTimeMs: number;
  queryId: string;
  verified: boolean;
}

export interface QueryRun {
  id: string;
  queryDefinition: QueryDefinition;
  executedAt: string;
  executionTimeMs: number;
  resultRowCount: number;
  dataSnapshot: Record<string, unknown>[];
}

// ==========================================
// 5. Analysis Plan & Run Contracts
// ==========================================

export type AnalysisGoal = 
  | 'identify_drivers' 
  | 'compare_periods' 
  | 'rank_entities' 
  | 'detect_anomalies' 
  | 'forecast_trend' 
  | 'general_summary';

export interface AnalysisStep {
  stepNumber: number;
  type: 'resolve_metric' | 'period_comparison' | 'dimension_breakdown' | 'anomaly_detection' | 'verify_calculation';
  description: string;
  metric?: string;
  dimensions?: string[];
  parameters?: Record<string, unknown>;
  completed: boolean;
  outputSummary?: string;
}

export interface AnalysisPlan {
  id: string;
  question: string;
  goal: AnalysisGoal;
  targetMetric: string;
  targetDimensions: string[];
  timeScope?: string;
  steps: AnalysisStep[];
  rationale: string;
}

export type AnalysisRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AnalysisResult {
  runId: string;
  summary: string;
  keyDrivers: string[];
  evidenceIds: string[];
  insights: Insight[];
  visualizationSpecs: VisualizationSpec[];
  graph: BusinessGraph;
  story: Story;
  presentationPlan: PresentationPlan;
}

export interface AnalysisRun {
  id: string;
  workspaceId: string;
  datasetVersionId: string;
  question: string;
  status: AnalysisRunStatus;
  startedAt: string;
  completedAt?: string;
  plan?: AnalysisPlan;
  stepsCompleted: number;
  totalSteps: number;
  queries: QueryRun[];
  result?: AnalysisResult;
  error?: string;
}

// ==========================================
// 6. Verification & Evidence Contracts
// ==========================================

export interface VerificationCheck {
  id: string;
  checkType: 'arithmetic' | 'aggregation' | 'filter_bounds' | 'denominator_non_zero' | 'cross_tab_consistency';
  claimText: string;
  expectedValue: number | string;
  calculatedValue: number | string;
  passed: boolean;
  delta?: number;
  details: string;
}

export interface VerificationResult {
  id: string;
  overallPassed: boolean;
  confidenceScore: number; // 0-1
  checks: VerificationCheck[];
  repairedClaimsCount: number;
  verifiedAt: string;
}

export interface Evidence {
  id: string;
  claim: string;
  datasetVersionId: string;
  queryRunId: string;
  calculationFormula: string;
  rawSampleData: Record<string, unknown>[];
  verificationResult: VerificationResult;
  stepTrace: string;
}

export interface Insight {
  id: string;
  type: 'driver' | 'trend' | 'anomaly' | 'comparison' | 'recommendation';
  title: string;
  narrative: string;
  impact: 'positive' | 'negative' | 'neutral';
  impactMagnitude: number; // e.g. percent change or absolute delta
  evidence: Evidence;
  suggestedAction?: string;
}

// ==========================================
// 7. Visualization Contracts
// ==========================================

export type VisualizationType = 
  | 'line' 
  | 'bar' 
  | 'stacked_bar' 
  | 'area' 
  | 'scatter' 
  | 'table' 
  | 'kpi' 
  | 'waterfall' 
  | 'donut'
  | 'heatmap';

export interface VisualizationSpec {
  id: string;
  title: string;
  subtitle?: string;
  type: VisualizationType;
  data: Record<string, unknown>[];
  encoding: {
    x?: { field: string; title?: string; type?: 'ordinal' | 'temporal' | 'quantitative' };
    y?: { field: string; title?: string; type?: 'quantitative' };
    series?: { field: string; title?: string };
    color?: string | string[];
    secondaryY?: { field: string; title?: string; type?: 'quantitative' };
  };
  formatting?: {
    valuePrefix?: string;
    valueSuffix?: string;
    decimalPlaces?: number;
    showDataLabels?: boolean;
  };
  annotations?: Array<{
    type: 'marker' | 'line' | 'band';
    label: string;
    value: number | string;
    color?: string;
  }>;
}

// ==========================================
// 8. Business Knowledge Graph Contracts
// ==========================================

export type NodeType = 'entity' | 'metric' | 'dimension' | 'driver' | 'insight' | 'action' | 'process';
export type EdgeType = 'causes' | 'contributes_to' | 'belongs_to' | 'depends_on' | 'related_to' | 'recommends';

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  data: {
    value?: string | number;
    delta?: string | number;
    status?: 'positive' | 'negative' | 'neutral';
    category?: string;
    details?: string;
  };
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  weight?: number; // 0 to 1
  animated?: boolean;
}

export interface BusinessGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootMetricId?: string;
}

// ==========================================
// 9. Story & Presentation Contracts
// ==========================================

export interface StorySection {
  id: string;
  title: string;
  type: 'executive_summary' | 'what_happened' | 'why_it_happened' | 'key_drivers' | 'evidence' | 'business_impact' | 'recommendations';
  headline: string;
  keyPoints: string[];
  supportedByEvidenceIds: string[];
  recommendedChartId?: string;
}

export interface Story {
  id: string;
  title: string;
  executiveTakeaway: string;
  sections: StorySection[];
  generatedAt: string;
}

export interface SlideElementSpec {
  type: 'text' | 'kpi_box' | 'chart' | 'table' | 'graph_preview' | 'bullet_list' | 'callout_box';
  x: number;
  y: number;
  width: number;
  height: number;
  content: unknown;
  style?: Record<string, unknown>;
}

export interface SlideSpec {
  slideNumber: number;
  template: 'executive_summary' | 'kpi_overview' | 'trend_analysis' | 'driver_breakdown' | 'business_graph' | 'action_plan' | 'evidence_appendix';
  title: string;
  subtitle?: string;
  elements: SlideElementSpec[];
  speakerNotes?: string;
}

export interface PresentationPlan {
  id: string;
  title: string;
  theme: 'corporate_onyx' | 'deep_crimson' | 'emerald_finance' | 'modern_clean';
  slides: SlideSpec[];
  totalSlides: number;
  createdAt: string;
}
