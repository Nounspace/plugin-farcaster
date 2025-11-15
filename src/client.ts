import { Content, logger } from '@elizaos/core';
import { type NeynarAPIClient, isApiErrorResponse } from '@neynar/nodejs-sdk';
import { Cast as NeynarCast } from '@neynar/nodejs-sdk/build/api';
// @ts-ignore
import { LRUCache } from 'lru-cache';
import { DEFAULT_CAST_CACHE_SIZE, DEFAULT_CAST_CACHE_TTL } from './common/constants';
import type { Cast, CastId, FidRequest, Profile } from './common/types';
import { neynarCastToCast, splitPostContent } from './common/utils';
import { ProfileFetcher } from './services/ProfileFetcher';


// add global cast cache
const castCache: LRUCache<string, NeynarCast> = new LRUCache({
  max: DEFAULT_CAST_CACHE_SIZE,
  ttl: DEFAULT_CAST_CACHE_TTL,
});

// add global profile cache
const profileCache: LRUCache<number, Profile> = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 15, // 15 minutes
});

export class FarcasterClient {
  public neynar: NeynarAPIClient;
  private signerUuid: string;
  private profileFetcher: ProfileFetcher;

  constructor(opts: { neynar: NeynarAPIClient; signerUuid: string }) {
    this.neynar = opts.neynar;
    this.signerUuid = opts.signerUuid;
    this.profileFetcher = new ProfileFetcher(this.neynar);
  }

  async sendCast({
    content,
    inReplyTo,
  }: {
    content: Content;
    inReplyTo?: CastId;
  }): Promise<NeynarCast[]> {
    const text = (content.text ?? '').trim();
    if (text.length === 0) {
      return [];
    }

    const chunks = splitPostContent(text);
    const sent: NeynarCast[] = [];

    for (const chunk of chunks) {
      const result = await this.publishCast(chunk, inReplyTo);
      sent.push(result);
    }
    return sent;
  }

  private async publishCast(cast: string, parentCastId?: CastId): Promise<NeynarCast> {
    try {
      const result = await this.neynar.publishCast({
        signerUuid: this.signerUuid,
        text: cast,
        parent: parentCastId?.hash,
      });
      if (result.success) {
        return this.getCast(result.cast.hash);
      }
      throw new Error(`[Farcaster] Error publishing [${cast}] parentCastId: [${parentCastId}]`);
    } catch (err) {
      if (isApiErrorResponse(err)) {
        logger.error(`Neynar error: ${JSON.stringify(err.response.data)}`);
        throw err.response.data;
      } else {
        logger.error(`Error: ${JSON.stringify(err)}`);
        throw err;
      }
    }
  }

  async getCast(castHash: string): Promise<NeynarCast> {
    const cachedCast = castCache.get(castHash);
    if (cachedCast) {
      return cachedCast;
    }

    const response = await this.neynar.lookupCastByHashOrUrl({ identifier: castHash, type: 'hash' });

    castCache.set(castHash, response.cast);

    return response.cast;
  }

  async getMentions(request: FidRequest): Promise<NeynarCast[]> {
    const neynarMentionsResponse = await this.neynar.fetchAllNotifications({
      fid: request.fid,
      type: ['mentions', 'replies'],
      limit: request.pageSize,
    });
    const mentions: NeynarCast[] = [];

    for (const notification of neynarMentionsResponse.notifications) {
      const neynarCast = notification.cast;
      if (neynarCast) {
        mentions.push(neynarCast);
      }
    }

    return mentions;
  }

  async getProfile(fid: number): Promise<Profile> {
    return this.profileFetcher.getProfile(fid);
  }

  async getTimeline(request: FidRequest): Promise<{
    timeline: Cast[];
    cursor?: string;
  }> {
    const timeline: Cast[] = [];

    const response = await this.neynar.fetchCastsForUser({
      fid: request.fid,
      limit: request.pageSize,
    });

    for (const cast of response.casts) {
      castCache.set(cast.hash, cast);
      timeline.push(neynarCastToCast(cast));
    }

    const nextCursor = response.next?.cursor ?? undefined;

    return {
      timeline,
      cursor: nextCursor,
    };
  }

  clearCache(): void {
    profileCache.clear();
    castCache.clear();
  }
}
