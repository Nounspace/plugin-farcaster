import {
  type UUID,
  logger,
  createUniqueUuid,
} from '@elizaos/core';
import type { FarcasterClient } from '../client';
import { castUuid, neynarCastToCast } from '../common/utils';
import { FARCASTER_SOURCE } from '../common/constants';
import type { Cast } from '../common/types';

// Simple interfaces for PostService compatibility  
interface Post {
  id: string;
  agentId: UUID;
  roomId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
  inReplyTo?: string;
  media?: any[];
  metadata?: any;
}

interface CreatePostOptions {
  agentId: UUID;
  roomId: string;
  text: string;
  media?: any[];
  inReplyTo?: string;
}

interface GetPostsOptions {
  agentId: UUID;
  roomId?: string;
  limit?: number;
}

interface IPostService {
  createPost(options: CreatePostOptions): Promise<Post>;
  getPosts(options: GetPostsOptions): Promise<Post[]>;
  getPost(postId: string, agentId: UUID): Promise<Post | null>;
  deletePost(postId: string, agentId: UUID): Promise<void>;
  likePost(postId: string, agentId: UUID): Promise<void>;
  unlikePost(postId: string, agentId: UUID): Promise<void>;
  repost(postId: string, agentId: UUID): Promise<void>;
  unrepost(postId: string, agentId: UUID): Promise<void>;
  getMentions(agentId: UUID, options?: Partial<GetPostsOptions>): Promise<Post[]>;
}

export class FarcasterCastService implements IPostService {
  constructor(
    private client: FarcasterClient,
    private runtime: any
  ) {}

  async createPost(options: CreatePostOptions): Promise<Post> {
    try {
      const { agentId, roomId, text, media, inReplyTo } = options;

      // Send the cast
      const casts = await this.client.sendCast({
        content: { text },
        inReplyTo: inReplyTo
          ? { hash: inReplyTo, fid: this.runtime.config.FARCASTER_FID }
          : undefined,
      });

      if (casts.length === 0) {
        throw new Error('No cast was created');
      }

      const cast = neynarCastToCast(casts[0]);
      const castResult: Post = {
        id: castUuid({ hash: cast.hash, agentId }),
        agentId,
        roomId,
        userId: cast.profile.fid.toString(),
        username: cast.profile.username,
        text: cast.text,
        timestamp: cast.timestamp.getTime(),
        inReplyTo,
        media: [], // TODO: Handle media upload when Farcaster API supports it
        metadata: {
          castHash: cast.hash,
          threadId: cast.threadId,
          authorFid: cast.authorFid,
          source: FARCASTER_SOURCE,
        },
      };

      return castResult;
    } catch (error) {
      logger.error('[Farcaster] Error creating cast:', error);
      throw error;
    }
  }

  async getPosts(options: GetPostsOptions): Promise<Post[]> {
    try {
      const { agentId, roomId, limit = 20 } = options;

      // Get timeline casts
      const { timeline } = await this.client.getTimeline({
        fid: this.runtime.config.FARCASTER_FID,
        pageSize: limit,
      });

      const casts: Post[] = timeline
        .filter((cast) => {
          if (roomId) {
            const castRoomId = createUniqueUuid(this.runtime, cast.threadId || cast.hash);
            return castRoomId === roomId;
          }
          return true;
        })
        .map((cast) => this.castToPost(cast, agentId));

      return casts;
    } catch (error) {
      logger.error('[Farcaster] Error fetching casts:', error);
      return [];
    }
  }

  async getPost(postId: string, agentId: UUID): Promise<Post | null> {
    try {
      // Extract cast hash from the post ID
      const castHash = postId; // Simplified - in production, maintain proper mapping

      const cast = await this.client.getCast(castHash);
      const farcasterCast = neynarCastToCast(cast);

      return this.castToPost(farcasterCast, agentId);
    } catch (error) {
      logger.error('[Farcaster] Error fetching cast:', error);
      return null;
    }
  }

  async deletePost(postId: string, agentId: UUID): Promise<void> {
    // Farcaster doesn't support deleting casts via API
    logger.warn('[Farcaster] Cast deletion is not supported by the Farcaster API');
  }

  async likePost(postId: string, agentId: UUID): Promise<void> {
    try {
      // Extract cast hash from the post ID
      const castHash = postId; // In production, maintain proper ID mapping

      // TODO: Implement like functionality when Neynar API supports it
      // For now, log the intent
      logger.info(`[Farcaster] Like functionality not yet implemented for cast: ${castHash}`);

      // In a full implementation, this would call the Neynar API
      // await this.client.neynar.likeCast({ signerUuid, castHash });
    } catch (error) {
      logger.error('[Farcaster] Error liking cast:', error);
      throw error;
    }
  }

  async unlikePost(postId: string, agentId: UUID): Promise<void> {
    try {
      // Extract cast hash from the post ID
      const castHash = postId;

      // TODO: Implement unlike functionality when Neynar API supports it
      logger.info(`[Farcaster] Unlike functionality not yet implemented for cast: ${castHash}`);

      // In a full implementation, this would call the Neynar API
      // await this.client.neynar.unlikeCast({ signerUuid, castHash });
    } catch (error) {
      logger.error('[Farcaster] Error unliking cast:', error);
      throw error;
    }
  }

  async repost(postId: string, agentId: UUID): Promise<void> {
    try {
      // Farcaster uses "recasts" instead of reposts
      const castHash = postId;

      // TODO: Implement recast functionality when Neynar API supports it
      logger.info(`[Farcaster] Recast functionality not yet implemented for cast: ${castHash}`);

      // In a full implementation, this would call the Neynar API
      // await this.client.neynar.recast({ signerUuid, castHash });
    } catch (error) {
      logger.error('[Farcaster] Error recasting:', error);
      throw error;
    }
  }

  async unrepost(postId: string, agentId: UUID): Promise<void> {
    try {
      // Remove recast
      const castHash = postId;

      // TODO: Implement unrecast functionality when Neynar API supports it
      logger.info(
        `[Farcaster] Remove recast functionality not yet implemented for cast: ${castHash}`
      );

      // In a full implementation, this would call the Neynar API
      // await this.client.neynar.unrecast({ signerUuid, castHash });
    } catch (error) {
      logger.error('[Farcaster] Error removing recast:', error);
      throw error;
    }
  }

  async getMentions(agentId: UUID, options?: Partial<GetPostsOptions>): Promise<Post[]> {
    try {
      const mentions = await this.client.getMentions({
        fid: this.runtime.config.FARCASTER_FID,
        pageSize: options?.limit || 20,
      });

      const mentionCasts: Post[] = mentions.map((castWithInteractions) => {
        const cast = neynarCastToCast(castWithInteractions);
        return this.castToPost(cast, agentId);
      });

      return mentionCasts;
    } catch (error) {
      logger.error('[Farcaster] Error fetching mentions:', error);
      return [];
    }
  }

  private castToPost(cast: Cast, agentId: UUID): Post {
    return {
      id: castUuid({ hash: cast.hash, agentId }),
      agentId,
      roomId: createUniqueUuid(this.runtime, cast.threadId || cast.hash),
      userId: cast.profile.fid.toString(),
      username: cast.profile.username,
      text: cast.text,
      timestamp: cast.timestamp.getTime(),
      media: [], // Farcaster casts can have embedded media but not in our Cast type
      metadata: {
        castHash: cast.hash,
        threadId: cast.threadId,
        authorFid: cast.authorFid,
        source: FARCASTER_SOURCE,
        stats: cast.stats,
      },
    };
  }
}
