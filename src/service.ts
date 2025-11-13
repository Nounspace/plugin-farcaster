import { logger, Service, UUID, type IAgentRuntime } from '@elizaos/core';
import { FARCASTER_SERVICE_NAME } from './common/constants';
import { FarcasterAgentManager } from './managers/agent';
import { hasFarcasterEnabled, validateFarcasterConfig } from './common/config';
import { FarcasterMessageService } from './services/MessageService';
import { FarcasterCastService } from './services/CastService';
import { SpamFilterManager } from './managers/spamFilterManager';
import { FarcasterStreamService } from './services/StreamService';

export class FarcasterService extends Service {
  private static instance?: FarcasterService;
  private managers = new Map<UUID, FarcasterAgentManager>();
  private messageServices = new Map<UUID, FarcasterMessageService>();
  private castServices = new Map<UUID, FarcasterCastService>();
  private sharedSpamFilter?: SpamFilterManager;
  private streamService?: FarcasterStreamService;

  // Properly implement serviceType for discoverability
  static serviceType = FARCASTER_SERVICE_NAME;

  // Add service description
  readonly description = 'Farcaster integration service for sending and receiving casts';
  readonly capabilityDescription = 'The agent is able to send and receive messages on farcaster';

  private static getInstance(): FarcasterService {
    if (!FarcasterService.instance) {
      FarcasterService.instance = new FarcasterService();
    }
    return FarcasterService.instance;
  }

  // Required by ElizaOS Service base class
  async initialize(runtime: IAgentRuntime): Promise<void> {
    await FarcasterService.start(runtime);
  }

  // Called to start a single Farcaster service
  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = FarcasterService.getInstance();
    let manager = service.managers.get(runtime.agentId);

    if (manager) {
      logger.warn('Farcaster service already started', runtime.agentId);
      return service;
    }

    if (!hasFarcasterEnabled(runtime)) {
      logger.debug('Farcaster service not enabled', runtime.agentId);
      return service;
    }

    const farcasterConfig = validateFarcasterConfig(runtime);

    if (farcasterConfig.FARCASTER_MODE === 'stream' && !service.streamService) {
      const { NeynarAPIClient, Configuration } = await import('@neynar/nodejs-sdk');
      const neynarConfig = new Configuration({ apiKey: farcasterConfig.FARCASTER_NEYNAR_API_KEY });
      const neynar = new NeynarAPIClient(neynarConfig);
      const { FarcasterClient } = await import('./client');
      const client = new FarcasterClient({ neynar, signerUuid: farcasterConfig.FARCASTER_SIGNER_UUID });
      
      service.streamService = FarcasterStreamService.getInstance({
        config: farcasterConfig,
        client: client,
        runtime: runtime,
      });
      service.streamService.start();
    }

    let spamFilter: SpamFilterManager | undefined;
    if (farcasterConfig.SPAM_FILTER_ENABLED) {
      if (farcasterConfig.SPAM_FILTER_SHARED) {
        if (!service.sharedSpamFilter) {
          service.sharedSpamFilter = new SpamFilterManager();
        }
        spamFilter = service.sharedSpamFilter;
      } else {
        spamFilter = new SpamFilterManager();
      }
    }

    manager = new FarcasterAgentManager(runtime, farcasterConfig, spamFilter);
    service.managers.set(runtime.agentId, manager);

    // Create and store MessageService and CastService instances
    const messageService = new FarcasterMessageService(manager.client, runtime);
    const castService = new FarcasterCastService(manager.client, runtime);

    service.messageServices.set(runtime.agentId, messageService);
    service.castServices.set(runtime.agentId, castService);

    await manager.start();

    logger.success('Farcaster client started', runtime.agentId);
    return service;
  }

  // Called to stop a single Farcaster service
  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = FarcasterService.getInstance();
    let manager = service.managers.get(runtime.agentId);
    if (manager) {
      await manager.stop();
      service.managers.delete(runtime.agentId);
      service.messageServices.delete(runtime.agentId);
      service.castServices.delete(runtime.agentId);
      logger.info('Farcaster client stopped', runtime.agentId);
    } else {
      logger.debug('Farcaster service not running', runtime.agentId);
    }
  }

  // Called to stop all Farcaster services
  async stop(): Promise<void> {
    logger.debug('Stopping ALL Farcaster services');
    if (this.streamService) {
      await this.streamService.stop();
    }
    for (const manager of Array.from(this.managers.values())) {
      const agentId = manager.runtime.agentId;
      try {
        await FarcasterService.stop(manager.runtime);
      } catch (error) {
        logger.error('Error stopping Farcaster service', agentId, error);
      }
    }
  }

  // Get the MessageService for a specific agent
  getMessageService(agentId: UUID): FarcasterMessageService | undefined {
    return this.messageServices.get(agentId);
  }

  /**
   * Get the PostService for a specific agent (for compatibility)
   * @deprecated Use getCastService() instead. Will be removed in a future major release.
   */
  getPostService(agentId: UUID): FarcasterCastService | undefined {
    return this.castServices.get(agentId);
  }

  // Get the CastService for a specific agent  
  getCastService(agentId: UUID): FarcasterCastService | undefined {
    return this.castServices.get(agentId);
  }

  // Add health check method
  async healthCheck(): Promise<{ healthy: boolean; details: Record<string, any> }> {
    const managerStatuses: Record<string, any> = {};
    let overallHealthy = true;

    for (const [agentId, manager] of Array.from(this.managers.entries())) {
      try {
        // Check if manager client is responsive
        const profile = await manager.client.getProfile(
          parseInt(manager.runtime.getSetting('FARCASTER_FID') as string)
        );
        managerStatuses[agentId] = {
          status: 'healthy',
          fid: profile.fid,
          username: profile.username,
        };
      } catch (error) {
        managerStatuses[agentId] = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        overallHealthy = false;
      }
    }

    return {
      healthy: overallHealthy,
      details: {
        activeManagers: this.managers.size,
        managerStatuses,
      },
    };
  }

  // Get all active managers (for monitoring)
  getActiveManagers(): Map<UUID, FarcasterAgentManager> {
    return new Map(this.managers);
  }
}
