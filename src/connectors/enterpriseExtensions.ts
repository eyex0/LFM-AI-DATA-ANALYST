import type { 
  Connector, 
  ConnectorCapabilities, 
  ConnectorMetadata, 
  HealthStatus, 
  SchemaDefinition 
} from './connector';
import type { DataProfile, QueryDefinition, QueryResult } from '../core/contracts';

/**
 * Base abstract class for future enterprise connectors.
 * These are explicit extension points designed for Phase 2/3 enterprise rollout.
 */
export abstract class AbstractEnterpriseConnector implements Connector {
  protected abstract sourceType: 'postgres' | 'snowflake' | 'bigquery' | 'salesforce' | 'powerbi';
  protected abstract connectionStringOrCredentials: unknown;

  abstract getMetadata(): Promise<ConnectorMetadata>;
  abstract capabilities(): ConnectorCapabilities;

  async discoverSchema(): Promise<SchemaDefinition> {
    throw new Error(
      `Connector [${this.sourceType}] is an enterprise extension point. Configured for enterprise activation.`
    );
  }

  async profile(): Promise<DataProfile> {
    throw new Error(
      `Connector [${this.sourceType}] is an enterprise extension point.`
    );
  }

  async executeQuery(_query: QueryDefinition): Promise<QueryResult> {
    throw new Error(
      `Connector [${this.sourceType}] is an enterprise extension point.`
    );
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: false,
      message: `Enterprise connector ${this.sourceType} requires remote database credentials.`,
      latencyMs: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
