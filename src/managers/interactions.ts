import {
  ChannelType,
  composePrompt,
  Content,
  createUniqueUuid,
  EventType,
  type IAgentRuntime,
  logger,
  type Memory,
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
import { createFarcasterInteractionSource, type FarcasterInteractionSource } from './interaction-source';

interface FarcasterInteractionManagerParams {
  client: FarcasterClient;
  runtime: IAgentRuntime;
  config: FarcasterConfig;
}

/**
 * Processes Farcaster interactions (mentions, replies) regardless of source (polling/webhook)
 * This class contains the core logic for handling interactions and manages the interaction source
 */
export class FarcasterInteractionManager {
  private client: FarcasterClient;
  private runtime: IAgentRuntime;
  private config: FarcasterConfig;
  private asyncQueue: AsyncQueue;
  
  // Mode and source management
  public readonly mode: 'polling' | 'webhook';
  public readonly source: FarcasterInteractionSource;

  constructor(opts: FarcasterInteractionManagerParams) {
    this.client = opts.client;
    this.runtime = opts.runtime;
    this.config = opts.config;
    this.asyncQueue = new AsyncQueue(1);
    
    // Initialize mode and source
    this.mode = opts.config.FARCASTER_MODE as 'polling' | 'webhook';
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
    
    await this.handleMentionCast({ agent, mention, cast });
  }

  /**
   * Process a reply from any source (webhook or polling)
   */
  async processReply(cast: NeynarCast): Promise<void> {
    // Similar to processMention but for replies
    const agentFid = this.config.FARCASTER_FID;
    const agent = await this.client.getProfile(agentFid);
    const reply = neynarCastToCast(cast);
    
    await this.handleMentionCast({ agent, mention: reply, cast });
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

    // Skip if it's from the agent itself
    if (castData.author.fid === agentFid) {
      logger.debug('Skipping webhook event from agent itself');
      return;
    }

    // Check if it's a mention
    const isMention = castData.mentioned_profiles?.some((profile: any) => profile.fid === agentFid);
    
    // Check if it's a reply to the agent
    const isReply = castData.parent_hash && castData.parent_author?.fid === agentFid;

    if (isMention) {
      logger.info(`Processing webhook MENTION from @${castData.author.username}: "${castData.text}"`);
      await this.processMention(castData);
    } else if (isReply) {
      logger.info(`Processing webhook REPLY from @${castData.author.username}: "${castData.text}"`);
      await this.processReply(castData);
    } else {
      logger.debug('Webhook cast is neither mention nor reply to agent');
    }
  }

  private async ensureCastConnection(cast: Cast): Promise<Memory> {
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
          worldName: `${cast.profile.username}'s Farcaster`,
          userName: cast.profile.username,
          name: cast.profile.name,
          source: FARCASTER_SOURCE,
          type: ChannelType.THREAD,
          channelId: conversationId,
          serverId,
          worldId,
          metadata: {
            ownership: { ownerId: cast.authorFid.toString() },
            farcaster: {
              username: cast.profile.username,
              id: cast.authorFid.toString(),
              name: cast.profile.name,
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
        createdAt: cast.timestamp.getTime(),
      };

      return memory;
    });
  }

  private async buildThreadForCast(cast: Cast, existingMemoryIds: Set<UUID>): Promise<Cast[]> {
    const client = this.client;
    const thread: Cast[] = [];

    const processThread = async (currentCast: Cast) => {
      const memoryId = castUuid({ agentId: this.runtime.agentId, hash: currentCast.hash });
      if (existingMemoryIds.has(memoryId)) {
        return;
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

  private async handleMentionCast({
    agent,
    mention,
    cast,
  }: {
    agent: Profile;
    cast: NeynarCast;
    mention: Cast;
  }): Promise<void> {
    if (mention.profile.fid === agent.fid) {
      logger.info('skipping cast from bot itself', mention.hash);
      return;
    }

    // Process one at a time to ensure proper sequencing
    const memory = await this.ensureCastConnection(mention);
    const thread: Cast[] = await this.buildThreadForCast(
      mention,
      memory.id ? new Set([memory.id]) : new Set()
    );

    if (!memory.content.text || memory.content.text.trim() === '') {
      logger.info('skipping cast with no text', mention.hash);
      return;
    }

    // Build the state for the prompt
    const currentPost = formatCast(mention);
    const { timeline } = await this.client.getTimeline({ fid: agent.fid, pageSize: 20 });
    const formattedTimeline = formatTimeline(this.runtime.character, timeline);
    const formattedConversation = thread
      .map((c) =>
        `
        - @${c.profile.username} (${formatCastTimestamp(c.timestamp)}):
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

    // Emit platform-specific MENTION_RECEIVED event
    const mentionPayload: FarcasterGenericCastPayload = {
      runtime: this.runtime,
      memory,
      cast,
      source: FARCASTER_SOURCE,
      callback: async (content: Content, _files: any[]) => {
        logger.info('[Farcaster] mention received response:', response);
        return [];
      },
    };
    this.runtime.emitEvent(FarcasterEventTypes.MENTION_RECEIVED, mentionPayload);
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

}
