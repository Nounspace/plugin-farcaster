import {
  type UUID,
  type IMessageService,
  type Message,
  MessageType,
  type GetMessagesOptions,
  type SendMessageOptions,
  logger,
  createUniqueUuid,
} from '@elizaos/core';
import type { FarcasterClient } from '../client';
import { castUuid, neynarCastToCast } from '../common/utils';
import { FARCASTER_SOURCE } from '../common/constants';

export class FarcasterMessageService implements IMessageService {
  constructor(
    private client: FarcasterClient,
    private runtime: any
  ) {}

  async getMessages(options: GetMessagesOptions): Promise<Message[]> {
    try {
      const { roomId, limit = 20 } = options;

      // Get mentions and timeline
      const { timeline } = await this.client.getTimeline({
        fid: parseInt(
          this.runtime.getSetting('FARCASTER_FID') || this.runtime.config.FARCASTER_FID
        ),
        pageSize: limit,
      });

      const messages: Message[] = timeline
        .filter((cast) => {
          if (roomId) {
            const castRoomId = createUniqueUuid(this.runtime, cast.threadId || cast.hash);
            return castRoomId === roomId;
          }
          return true;
        })
        .map((cast) => ({
          id: castUuid({ hash: cast.hash, agentId: this.runtime.agentId }),
          agentId: this.runtime.agentId,
          roomId: createUniqueUuid(this.runtime, cast.threadId || cast.hash),
          userId: cast.profile.fid.toString(),
          username: cast.profile.username,
          text: cast.text,
          type: cast.inReplyTo ? MessageType.REPLY : MessageType.POST,
          timestamp: cast.timestamp.getTime(),
          inReplyTo: cast.inReplyTo
            ? castUuid({ hash: cast.inReplyTo.hash, agentId: this.runtime.agentId })
            : undefined,
          metadata: {
            castHash: cast.hash,
            threadId: cast.threadId,
            authorFid: cast.authorFid,
          },
        }));

      return messages;
    } catch (error) {
      logger.error('[Farcaster] Error fetching messages:', error);
      return [];
    }
  }

  async sendMessage(options: SendMessageOptions): Promise<Message> {
    try {
      const { text, type, roomId, replyToId, agentId } = options;

      let inReplyTo: { hash: string; fid: number } | undefined = undefined;
      if (replyToId && type === MessageType.REPLY) {
        // Extract cast hash from the message ID (which is a UUID)
        // In a real implementation, you'd need to maintain a mapping or extract from metadata
        const parentHash = options.metadata?.parentHash || replyToId;
        inReplyTo = {
          hash: parentHash as string,
          fid: parseInt(
            this.runtime.getSetting('FARCASTER_FID') || this.runtime.config.FARCASTER_FID
          ),
        };
      }

      const casts = await this.client.sendCast({
        content: { text },
        inReplyTo,
      });

      if (casts.length === 0) {
        throw new Error('No cast was created');
      }

      const cast = neynarCastToCast(casts[0]);
      const message: Message = {
        id: castUuid({ hash: cast.hash, agentId }),
        agentId,
        roomId,
        userId: cast.profile.fid.toString(),
        username: cast.profile.username,
        text: cast.text,
        type,
        timestamp: cast.timestamp.getTime(),
        inReplyTo: inReplyTo ? castUuid({ hash: inReplyTo.hash, agentId }) : undefined,
        metadata: {
          ...options.metadata,
          castHash: cast.hash,
          threadId: cast.threadId,
          authorFid: cast.authorFid,
        },
      };

      // Emit event for metadata tracking
      await this.runtime.emitEvent('FARCASTER_CAST_SENT', {
        runtime: this.runtime,
        castHash: cast.hash,
        message,
        threadId: cast.threadId,
      });

      return message;
    } catch (error) {
      logger.error('[Farcaster] Error sending message:', error);
      throw error;
    }
  }

  async deleteMessage(messageId: string, agentId: UUID): Promise<void> {
    // Farcaster doesn't support deleting casts via API
    logger.warn('[Farcaster] Cast deletion is not supported by the Farcaster API');
  }

  async getMessage(messageId: string, agentId: UUID): Promise<Message | null> {
    try {
      // Extract cast hash from the message ID
      // In production, you'd need to maintain a proper mapping
      const castHash = messageId; // Simplified for now

      const cast = await this.client.getCast(castHash);
      const farcasterCast = neynarCastToCast(cast);

      const message: Message = {
        id: castUuid({ hash: farcasterCast.hash, agentId }),
        agentId,
        roomId: createUniqueUuid(this.runtime, farcasterCast.threadId || farcasterCast.hash),
        userId: farcasterCast.profile.fid.toString(),
        username: farcasterCast.profile.username,
        text: farcasterCast.text,
        type: farcasterCast.inReplyTo ? MessageType.REPLY : MessageType.POST,
        timestamp: farcasterCast.timestamp.getTime(),
        inReplyTo: farcasterCast.inReplyTo
          ? castUuid({ hash: farcasterCast.inReplyTo.hash, agentId })
          : undefined,
        metadata: {
          castHash: farcasterCast.hash,
          threadId: farcasterCast.threadId,
          authorFid: farcasterCast.authorFid,
        },
      };

      return message;
    } catch (error) {
      logger.error('[Farcaster] Error fetching message:', error);
      return null;
    }
  }

  async markAsRead(messageIds: string[], agentId: UUID): Promise<void> {
    // Farcaster doesn't have a read/unread concept
    logger.debug('[Farcaster] Mark as read is not applicable for Farcaster casts');
  }
}
