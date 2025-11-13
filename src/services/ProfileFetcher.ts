import { elizaLogger, logger } from '@elizaos/core';
import type { Profile } from '../common/types';

const MAX_BATCH_SIZE = 40;         // how many FIDs per batch
const BATCH_INTERVAL = 200;        // how long to wait before firing batch
const MAX_RETRIES = 5;             // exponential backoff limit
const INITIAL_BACKOFF = 500;       // ms

type ProfileRequest = {
  fid: number;
  resolve: (p: Profile) => void;
  reject: (e: any) => void;
};

export class ProfileFetcher {
  private neynar: any;
  private profileCache = new Map<number, Profile>();
  private inFlight = new Map<number, Promise<Profile>>(); // deduplication map
  private buffer: ProfileRequest[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor(neynarClient: any) {
    this.neynar = neynarClient;
  }

  /** Get a user profile by FID, with caching, batching, deduping and backoff. */
  async getProfile(fid: number): Promise<Profile> {
    // 1️⃣ Cache hit → return immediately
    if (this.profileCache.has(fid)) {
      return this.profileCache.get(fid)!;
    }

    // 2️⃣ In-flight → wait for the same Promise
    if (this.inFlight.has(fid)) {
      return this.inFlight.get(fid)!;
    }

    // 3️⃣ Queue new request → Promise is stored in inFlight map
    const promise = new Promise<Profile>((resolve, reject) => {
      this.buffer.push({ fid, resolve, reject });
      this.scheduleBatch();
    });

    this.inFlight.set(fid, promise);

    // Once resolved or rejected, clean up in-flight map
    promise.finally(() => this.inFlight.delete(fid));

    return promise;
  }

  /** Schedule a batch flush if one isn’t already pending. */
  private scheduleBatch() {
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_INTERVAL);
    }
  }

  /** Executes one bulk fetch for all buffered requests. */
  private async flushBatch() {
    const batch = this.buffer.splice(0, MAX_BATCH_SIZE);
    this.batchTimer = null;
    if (batch.length === 0) return;

    const uniqueFidsSet = new Set(batch.map(b => b.fid));
    const fids = Array.from(uniqueFidsSet);
    logger.info(`Fetching ${fids.length} profiles in bulk...`);

    try {
      const result = await this.fetchWithRetry(fids);
      const userMap = new Map<number, Profile>();

      for (const user of result.users ?? []) {
        const profile: Profile = {
          fid: user.fid,
          name: user.display_name ?? '',
          username: user.username ?? '',
          bio: user.profile?.bio?.text ?? '',
          pfp: user.pfp_url ?? '',
          score: user.score ?? 0,
        };
        this.profileCache.set(user.fid, profile);
        userMap.set(user.fid, profile);
      }

      for (const { fid, resolve, reject } of batch) {
        const profile = userMap.get(fid);
        if (profile) resolve(profile);
        else reject(new Error(`Profile for FID ${fid} not found`));
      }

    } catch (error) {
      elizaLogger.error(`Bulk fetch failed: ${JSON.stringify(error)}`);
      for (const { reject } of batch) reject(error);
    }

    // Keep draining if more accumulated during fetch
    if (this.buffer.length > 0) this.scheduleBatch();
  }

  /** Retry with exponential backoff for rate limits (429). */
  private async fetchWithRetry(fids: number[], attempt = 1): Promise<any> {
    try {
      return await this.neynar.fetchBulkUsers({ fids });
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status;
      if (status === 429 && attempt <= MAX_RETRIES) {
        const delay = INITIAL_BACKOFF * 2 ** (attempt - 1);
        logger.warn(`429 rate limited (attempt ${attempt}). Retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.fetchWithRetry(fids, attempt + 1);
      }
      throw err;
    }
  }

  private sleep(ms: number) {
    return new Promise(res => setTimeout(res, ms));
  }
}
