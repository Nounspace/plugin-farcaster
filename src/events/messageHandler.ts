import {
  type IAgentRuntime,
  type Memory,
  logger,
  EventType,
  type MessagePayload,
  createUniqueUuid,
  type UUID,
} from '@elizaos/core';
import { FARCASTER_SERVICE_NAME, FARCASTER_SOURCE } from '../common/constants';
import type { FarcasterService } from '../service';

/**
 * Handles when a Farcaster message is sent by the agent
 * Stores metadata to connect the sent message with its cast hash
 */
export const handleCastSent = async (payload: {
  runtime: IAgentRuntime;
  castHash: string;
  message: Memory;
  threadId?: string;
}): Promise<void> => {
  const { runtime, castHash, message, threadId } = payload;
  try {

    // Create metadata mapping
    const metadata = {
      castHash,
      threadId: threadId || castHash,
      platform: 'farcaster',
      messageId: message.id,
      sentAt: Date.now(),
    };

    // Store the mapping in a dedicated memory for tracking
    await runtime.createMemory(
      {
        agentId: runtime.agentId,
        roomId: message.roomId,
        entityId: runtime.agentId,
        content: {
          text: `Cast sent: ${castHash}`,
          metadata,
          source: FARCASTER_SOURCE,
        },
        createdAt: Date.now(),
      },
      'metadata'
    );

    runtime.logger.info(`[FarcasterMessageHandler] Stored cast metadata: ${castHash}`);
  } catch (error) {
    runtime.logger.error('[FarcasterMessageHandler] Error storing cast metadata:', typeof error === 'string' ? error : (error as Error).message);
  }
};

/**
 * Handles incoming Farcaster messages and enriches them with metadata
 */
export const handleCastReceived = async (payload: MessagePayload): Promise<void> => {
  if (payload.source !== FARCASTER_SOURCE) {
    return;
  }

  const { runtime, message } = payload;
  try {

    // Extract cast metadata
    const castHash = (message.content.metadata as any)?.castHash;
    const threadId = (message.content.metadata as any)?.threadId;

    if (castHash) {
      // Store enriched metadata
      await runtime.createMemory(
        {
          agentId: runtime.agentId,
          roomId: message.roomId,
          entityId: message.entityId,
          content: {
            text: `Cast received: ${castHash}`,
            metadata: {
              originalMessageId: message.id,
              castHash,
              threadId: threadId || castHash,
              platform: 'farcaster',
              receivedAt: Date.now(),
            },
            source: FARCASTER_SOURCE,
          },
          createdAt: Date.now(),
        },
        'metadata'
      );

      runtime.logger.info(`[FarcasterMessageHandler] Processed incoming cast: ${castHash}`);
    }
  } catch (error) {
    runtime.logger.error('[FarcasterMessageHandler] Error processing incoming cast:', typeof error === 'string' ? error : (error as Error).message);
  }
};

/**
 * Links reply casts to their parent conversations
 */
export const handleReplyTracking = async (payload: {
  runtime: IAgentRuntime;
  replyCastHash: string;
  parentCastHash: string;
  roomId: UUID;
}): Promise<void> => {
  const { runtime, replyCastHash, parentCastHash, roomId } = payload;
  try {

    // Create relationship metadata
    await runtime.createMemory(
      {
        agentId: runtime.agentId,
        roomId,
        entityId: runtime.agentId,
        content: {
          text: `Reply relationship: ${replyCastHash} -> ${parentCastHash}`,
          metadata: {
            type: 'reply_relationship',
            replyCastHash,
            parentCastHash,
            platform: 'farcaster',
            createdAt: Date.now(),
          },
          source: FARCASTER_SOURCE,
        },
        createdAt: Date.now(),
      },
      'relationships'
    );

    runtime.logger.info(
      `[FarcasterMessageHandler] Linked reply ${replyCastHash} to parent ${parentCastHash}`
    );
  } catch (error) {
    runtime.logger.error('[FarcasterMessageHandler] Error tracking reply relationship:', typeof error === 'string' ? error : (error as Error).message);
  }
};

/**
 * Register all Farcaster event handlers
 */
export const registerFarcasterEventHandlers = (runtime: IAgentRuntime): void => {
  // Handle incoming messages
  runtime.emitEvent(EventType.MESSAGE_RECEIVED, handleCastReceived);

  logger.info('[FarcasterMessageHandler] Event handlers registered');
};
