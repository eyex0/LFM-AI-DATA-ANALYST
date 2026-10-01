import type { 
  DatasetColumn, 
  DataProfile, 
  QueryDefinition, 
  QueryResult, 
  SupportedSourceType 
} from '../core/contracts';

export interface SchemaDefinition {
  tableName: string;
  columns: DatasetColumn[];
  sheets?: string[];
  primaryKeys?: string[];
  totalEstimatedRows?: number;
}

export interface ConnectorMetadata {
  sourceType: SupportedSourceType;
  name: string;
  version: string;
  sourceIdentifier: string;
  connectionState: 'connected' | 'disconnected' | 'error';
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  latencyMs: number;
  timestamp: string;
}

export interface ConnectorCapabilities {
  supportsMultiSheet: boolean;
  supportsStreaming: boolean;
  supportsCustomSQL: boolean;
  supportsSchemaDiscovery: boolean;
  supportsRealTimeSync: boolean;
  maxRecommendedRows: number;
}

export interface Connector {
  discoverSchema(): Promise<SchemaDefinition>;
  profile(): Promise<DataProfile>;
  executeQuery(query: QueryDefinition): Promise<QueryResult>;
  getMetadata(): Promise<ConnectorMetadata>;
  healthCheck(): Promise<HealthStatus>;
  capabilities(): ConnectorCapabilities;
}
