import { logger, type IAgentRuntime } from '@elizaos/core';
import { Configuration, NeynarAPIClient } from '@neynar/nodejs-sdk';
import { FarcasterClient } from '../client';
import { type FarcasterConfig } from '../common/types';
import { FarcasterCastManager } from './post';
import { FarcasterInteractionManager } from './interactions';
import { createFarcasterInteractionSource, FarcasterWebhookSource } from './interaction-source';

/**
 * A manager that orchestrates all Farcaster operations:
 * - client: base operations (Neynar client, hub connection, etc.)
 * - posts: autonomous posting logic
 * - interactions: handling mentions, replies, likes, etc. (via processor + source)
 */
export class FarcasterAgentManager {
  readonly runtime: IAgentRuntime;
  readonly client: FarcasterClient;
  readonly casts: FarcasterCastManager;
  readonly processor: FarcasterInteractionManager;
  readonly source: any; // FarcasterInteractionSource
  readonly webhookSource?: FarcasterWebhookSource; // For webhook access
  readonly config: FarcasterConfig;

  constructor(runtime: IAgentRuntime, config: FarcasterConfig) {
    this.runtime = runtime;
    this.config = config;
    const signerUuid = config.FARCASTER_SIGNER_UUID;

    const neynarConfig = new Configuration({ apiKey: config.FARCASTER_NEYNAR_API_KEY });
    const neynar = new NeynarAPIClient(neynarConfig);
    const client = new FarcasterClient({ neynar, signerUuid });

    this.client = client;

    logger.success('Farcaster Neynar client initialized.');

    // Initialize the new architecture
    this.processor = new FarcasterInteractionManager({ client, runtime, config });
    this.source = createFarcasterInteractionSource({ 
      client, 
      runtime, 
      config, 
      processor: this.processor 
    });

    // Store webhook source reference if in webhook mode
    if (config.FARCASTER_MODE === 'webhook' && this.source instanceof FarcasterWebhookSource) {
      this.webhookSource = this.source;
    }

    this.casts = new FarcasterCastManager({ client, runtime, config });

    logger.info(`Farcaster interaction mode: ${config.FARCASTER_MODE}`);
  }

  async start() {
    await Promise.all([this.casts.start(), this.source.start()]);
  }

  async stop() {
    await Promise.all([this.casts.stop(), this.source.stop()]);
  }
}
