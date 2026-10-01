import type { Organization, Workspace, User, TenancyContext } from './contracts';

export class TenancyManager {
  private static defaultOrg: Organization = {
    id: 'org_default_enterprise',
    name: 'LFM Global Enterprise',
    slug: 'lfm-enterprise',
    createdAt: new Date().toISOString(),
  };

  private static defaultWorkspace: Workspace = {
    id: 'ws_default_analytics',
    organizationId: 'org_default_enterprise',
    name: 'Executive Analytics Workspace',
    slug: 'exec-analytics',
    createdAt: new Date().toISOString(),
  };

  private static defaultUser: User = {
    id: 'usr_default_exec',
    organizationId: 'org_default_enterprise',
    email: 'executive@lfm-analyst.ai',
    name: 'Chief Analytics Officer',
    role: 'admin',
  };

  public static getDefaultContext(): TenancyContext {
    return {
      organizationId: this.defaultOrg.id,
      workspaceId: this.defaultWorkspace.id,
      userId: this.defaultUser.id,
    };
  }

  public static getOrganization(): Organization {
    return this.defaultOrg;
  }

  public static getWorkspace(): Workspace {
    return this.defaultWorkspace;
  }

  public static getUser(): User {
    return this.defaultUser;
  }
}
