import {
  type IAgentRuntime,
  type Memory,
  ChannelType,
  composePrompt,
  Content,
  createUniqueUuid,
  EventType,
  logger,
  MessagePayload,
  ModelType,
  UUID,
} from '@elizaos/core';
import { Cast as NeynarCast } from '@neynar/nodejs-sdk/build/api';
import type { FarcasterClient } from '../client';
import { AsyncQueue } from '../common/asyncqueue';
import { standardCastHandlerCallback } from '../common/callbacks';
import { FARCASTER_SOURCE } from '../common/constants';
import { formatCast, formatTimeline } from '../common/prompts';
import { shouldRespondTemplate } from '@elizaos/core';
import {
  type Cast,
  type FarcasterConfig,
  FarcasterEventTypes,
  FarcasterGenericCastPayload,
  type Profile,
} from '../common/types';
import { castUuid, formatCastTimestamp, neynarCastToCast } from '../common/utils';
import {
  FarcasterInteractionSource,
  FarcasterPollingSource,
  FarcasterWebhookSource,
  FarcasterStreamSource,
} from './interaction-source';
import type { IInteractionProcessor } from './interaction-processor';
import { SpamFilterManager } from './spamFilterManager';
import { shouldRespondSecurityTemplate } from '../common/prompts/spam';

interface FarcasterInteractionSourceParams {
  client: FarcasterClient;
  runtime: IAgentRuntime;
  config: FarcasterConfig;
  processor: IInteractionProcessor;
}

/**
 * Factory function to create the appropriate interaction source based on config
 */
export function createFarcasterInteractionSource(
  params: FarcasterInteractionSourceParams
): FarcasterInteractionSource {
  switch (params.config.FARCASTER_MODE) {
    case 'webhook':
      return new FarcasterWebhookSource(params);
    case 'stream':
      if (!params.config.FARCASTER_HUB_RPC) {
        logger.error('FARCASTER_HUB_RPC is required for stream mode.');
        logger.warn('FARCASTER_HUB_RPC is not set for stream mode. Falling back to polling mode.');
        return new FarcasterPollingSource(params);
      }
      return new FarcasterStreamSource(params);
    case 'polling':
    default:
      return new FarcasterPollingSource(params);
  }
}

interface FarcasterInteractionManagerParams {
  client: FarcasterClient;
  runtime: IAgentRuntime;
  config: FarcasterConfig;
  spamFilter?: SpamFilterManager;
}

/**
 * Processes Farcaster interactions (mentions, replies) regardless of source (polling/webhook)
 * This class contains the core logic for handling interactions and manages the interaction source
 */
export class FarcasterInteractionManager implements IInteractionProcessor {
  private client: FarcasterClient;
  private runtime: IAgentRuntime;
  private config: FarcasterConfig;
  private asyncQueue: AsyncQueue;
  private spamFilter?: SpamFilterManager;
  
  // Mode and source management
  public readonly mode: 'polling' | 'webhook' | "stream";
  public readonly source: FarcasterInteractionSource;

  constructor(opts: FarcasterInteractionManagerParams) {
    this.client = opts.client;
    this.runtime = opts.runtime;
    this.config = opts.config;
    this.asyncQueue = new AsyncQueue(1);
    this.spamFilter = opts.spamFilter;
    
    // Initialize mode and source
    this.mode = opts.config.FARCASTER_MODE as 'polling' | 'webhook' | "stream";
    this.source = createFarcasterInteractionSource({
      client: this.client,
      runtime: this.runtime,
      config: this.config,
      processor: this
    });
    
    logger.info(`Farcaster interaction mode: ${this.mode}`);
  }

  /**
   * Process a mention from any source (webhook or polling)
   */
  async processMention(cast: NeynarCast): Promise<void> {
    const agentFid = this.config.FARCASTER_FID;
    const agent = await this.client.getProfile(agentFid);
    const mention = neynarCastToCast(cast);
    
    await this.handleMentionCast({ agent, mention, neynarCast: cast });
  }

  /**
   * Process a reply from any source (webhook or polling)
   */
  async processReply(cast: NeynarCast): Promise<void> {
    // Similar to processMention but for replies
    const agentFid = this.config.FARCASTER_FID;
    const agent = await this.client.getProfile(agentFid);
    const reply = neynarCastToCast(cast);
    
    await this.handleMentionCast({ agent, mention: reply, neynarCast: cast });
  }

  async processStreamedCast(cast: Cast): Promise<void> {
    logger.info(`Processing streamed cast: ${cast.hash}`);
    await this.handleStreamedMentionCast(cast);
  }

  /**
   * Process webhook data from Neynar
   */
  async processWebhookData(webhookData: any): Promise<void> {
    if (webhookData.type !== 'cast.created' || !webhookData.data) {
      logger.debug('Ignoring non-cast webhook event:', webhookData.type);
      return;
    }

    const castData = webhookData.data;
    const agentFid = this.config.FARCASTER_FID;

    // Validate required cast data structure
    if (!castData.author || !castData.hash || typeof castData.author.fid !== 'number') {
      logger.warn('Invalid webhook cast data structure - missing author, hash, or author.fid');
      return;
    }

    // Skip if it's from the agent itself
    if (castData.author.fid === agentFid) {
      logger.debug('Skipping webhook event from agent itself');
      return;
    }

    // Deduplication check - skip if already processed
    const memoryId = castUuid({ agentId: this.runtime.agentId, hash: castData.hash });
    if (await this.runtime.getMemoryById(memoryId)) {
      logger.debug('Skipping already processed webhook cast:', castData.hash);
      return;
    }

    // Check if it's a mention
    const isMention = castData.mentioned_profiles?.some((profile: any) => profile.fid === agentFid);
    
    // Check if it's a reply to the agent
    const isReply = castData.parent_hash && castData.parent_author?.fid === agentFid;

    if (isMention) {
      const username = castData.author.username || 'unknown';
      const text = castData.text || '';
      logger.info(`Processing webhook MENTION from @${username}: "${text}"`);
      
      try {
        // Fetch the proper NeynarCast object using the cast hash
        const neynarCast = await this.client.getCast(castData.hash);
        await this.processMention(neynarCast);
      } catch (error) {
        logger.error(`Failed to process webhook mention from @${username}:`, error instanceof Error ? error.message : String(error));
      }
    } else if (isReply) {
      const username = castData.author.username || 'unknown';
      const text = castData.text || '';
      logger.info(`Processing webhook REPLY from @${username}: "${text}"`);
      
      try {
        // Fetch the proper NeynarCast object using the cast hash
        const neynarCast = await this.client.getCast(castData.hash);
        await this.processReply(neynarCast);
      } catch (error) {
        logger.error(`Failed to process webhook reply from @${username}:`, error instanceof Error ? error.message : String(error));
      }
    } else {
      logger.debug('Webhook cast is neither mention nor reply to agent');
    }
  }

  public async ensureCastConnection(cast: Cast): Promise<Memory> {
    return await this.asyncQueue.submit(async () => {
      const memoryId = castUuid({ agentId: this.runtime.agentId, hash: cast.hash });
      const conversationId = cast.threadId ?? cast.inReplyTo?.hash ?? cast.hash;
      const entityId = createUniqueUuid(this.runtime, cast.authorFid.toString());
      const worldId = createUniqueUuid(this.runtime, cast.authorFid.toString());
      const serverId = cast.authorFid.toString();
      const roomId = createUniqueUuid(this.runtime, conversationId);

      if (entityId !== this.runtime.agentId) {
        await this.runtime.ensureConnection({
          entityId,
          roomId,
          worldName: `${cast.username}'s Farcaster`,
          userName: cast.username,
          name: cast.username,
          source: FARCASTER_SOURCE,
          type: ChannelType.THREAD,
          channelId: conversationId,
          serverId,
          worldId,
          metadata: {
            ownership: { ownerId: cast.authorFid.toString() },
            farcaster: {
              username: cast.username,
              id: cast.authorFid.toString(),
              name: cast.username,
            },
          },
        });
      }

      const memory: Memory = {
        id: memoryId,
        agentId: this.runtime.agentId,
        content: {
          text: cast.text,
          inReplyTo: cast.inReplyTo?.hash
            ? castUuid({ agentId: this.runtime.agentId, hash: cast.inReplyTo.hash })
            : undefined,
          source: FARCASTER_SOURCE,
          channelType: ChannelType.THREAD,
        },
        entityId,
        roomId,
      };

      return memory;
    });
  }

  private async buildThreadForCast(cast: Cast, skipMemoryId: Set<UUID>): Promise<Cast[]> {
    const thread: Cast[] = [];
    const visited: Set<string> = new Set();
    const client = this.client;
    const runtime = this.runtime;
    const self = this;

    async function processThread(currentCast: Cast) {
      const memoryId = castUuid({ hash: currentCast.hash, agentId: runtime.agentId });

      if (visited.has(currentCast.hash) || skipMemoryId.has(memoryId)) {
        return;
      }

      visited.add(currentCast.hash);

      // Check if the current cast has already been saved
      const memory = await runtime.getMemoryById(memoryId);

      if (!memory) {
        logger.info('Creating memory for cast', currentCast.hash);
        const memory = await self.ensureCastConnection(currentCast);
        await runtime.createMemory(memory, 'messages');
        runtime.emitEvent(FarcasterEventTypes.THREAD_CAST_CREATED, {
          runtime,
          memory,
          cast: currentCast,
          source: FARCASTER_SOURCE,
        });
      }

      thread.unshift(currentCast);

      if (currentCast.inReplyTo) {
        const parentCast = await client.getCast(currentCast.inReplyTo.hash);
        await processThread(neynarCastToCast(parentCast));
      }
    }

    await processThread(cast);
    return thread;
  }

  private async handleStreamedMentionCast(mention: Cast): Promise<void> {
    if (mention.authorFid === this.config.FARCASTER_FID) {
        logger.info('skipping cast from bot itself', mention.hash);
        return;
    }

    const memory = await this.ensureCastConnection(mention);
    const thread: Cast[] = await this.buildThreadForCast(
        mention,
        memory.id ? new Set([memory.id]) : new Set()
    );

    await this.processInteractionLogic(mention, thread, memory);
  }

  private async handleMentionCast({
    agent,
    mention,
    neynarCast,
  }: {
    agent: Profile;
    mention: Cast;
    neynarCast: NeynarCast;
  }): Promise<void> {
    
    if (mention.authorFid === agent.fid) {
      logger.info('skipping cast from bot itself', mention.hash);
      return;
    }

    const memory = await this.ensureCastConnection(mention);
    const thread: Cast[] = await this.buildThreadForCast(
      mention,
      memory.id ? new Set([memory.id]) : new Set()
    );

    await this.processInteractionLogic(mention, thread, memory);

    // Emit platform-specific MENTION_RECEIVED event
    const mentionPayload: FarcasterGenericCastPayload = {
      runtime: this.runtime,
      memory,
      cast: neynarCast,
      source: FARCASTER_SOURCE,
      callback: async (content: Content, _files?: any[]) => {
        logger.info('Farcaster','mention received response:', content);
        return [];
      },
    };
    this.runtime.emitEvent(FarcasterEventTypes.MENTION_RECEIVED, mentionPayload);
  }

  private async processInteractionLogic(mention: Cast, thread: Cast[], memory: Memory): Promise<void> {
    if (!memory.content.text || memory.content.text.trim() === '') {
      logger.info('skipping cast with no text', mention.hash);
      return;
    }

    const agent = await this.client.getProfile(this.config.FARCASTER_FID);

    // Build the state for the prompt
    const currentPost = formatCast(mention);
    const { timeline } = await this.client.getTimeline({ fid: agent.fid, pageSize: 20 });
    const formattedTimeline = formatTimeline(this.runtime.character, timeline);
    const formattedConversation = thread
      .map((c) =>
        `
        - @${c.username} (${formatCastTimestamp(c.timestamp)}):
          ${c.text}`.trim()
      )
      .join('\n\n');

    const state = await this.runtime.composeState(memory);
    state.values = {
      ...state.values,
      farcasterUsername: agent.username,
      timeline: formattedTimeline,
      currentPost,
      formattedConversation,
    };

    // Spam filter check
    if (this.config.SPAM_FILTER_ENABLED && this.spamFilter) {
      if (this.spamFilter.isUserBlocked(memory.entityId)) {
        logger.warn(`User ${mention.username} is blocked. Ignoring mention.`);
        return;
      }

      const spamPrompt = this.config.SPAM_FILTER_PROMPT || shouldRespondSecurityTemplate;
      const spamCheckPrompt = composePrompt({ state, template: spamPrompt });
      const spamResponse = await this.runtime.useModel(ModelType.TEXT_SMALL, { prompt: spamCheckPrompt });
      const spamAction = (spamResponse.match(/(?:CONTINUE|STOP)/g) || ['RESPOND'])[0];

      if (spamAction === 'STOP') {
        logger.warn(`Spam filter triggered for user ${mention.username}. Adding to blocklist.`);
        this.spamFilter.addUserToBlockList(mention.username, memory.entityId);
        return;
      }
    }

    // Determine if we should respond to the cast
    const shouldRespondPrompt = composePrompt({
      state,
      template:
        this.runtime.character.templates?.farcasterShouldRespondTemplate ||
        this.runtime.character?.templates?.shouldRespondTemplate ||
        shouldRespondTemplate,
    });

    const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
      prompt: shouldRespondPrompt,
    });

    const responseActions = (response.match(/(?:RESPOND|IGNORE|STOP)/g) || ['IGNORE'])[0];
    if (responseActions !== 'RESPOND') {
      logger.info(`Not responding to cast based on shouldRespond decision: ${responseActions}`);
      try {
        // save the memory so we don't process it again in mentions
        await this.runtime.createMemory(memory, 'messages');
      } catch (error) {
        logger.error(`Error creating ignoredmemory: ${JSON.stringify(error)}`);
      }
      return;
    }

    // setup callback for the response
    const callback = standardCastHandlerCallback({
      client: this.client,
      runtime: this.runtime,
      config: this.config,
      roomId: memory.roomId,
      inReplyTo: {
        hash: mention.hash,
        fid: mention.authorFid,
      },
    });

    // Emit generic message received events
    const messageReceivedPayload: MessagePayload = {
      runtime: this.runtime,
      message: memory,
      source: FARCASTER_SOURCE,
      callback,
    };

    this.runtime.emitEvent(EventType.MESSAGE_RECEIVED, messageReceivedPayload);
  }

  /**
   * Start the interaction manager (delegates to the appropriate source)
   */
  async start(): Promise<void> {
    logger.info(`Starting Farcaster interaction manager in ${this.mode} mode`);
    await this.source.start();
  }

  /**
   * Stop the interaction manager
   */
  async stop(): Promise<void> {
    logger.info('Stopping Farcaster interaction manager');
await this.source.stop();
  }

  public getInteractionConfig():FarcasterConfig {
    return this.config;
  }

}
