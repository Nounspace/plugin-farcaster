import {
  type Provider,
  type IAgentRuntime,
  type Memory,
  type State,
  type ProviderResult,
  logger,
} from '@elizaos/core';
import { FARCASTER_SERVICE_NAME } from '../common/constants';
import type { FarcasterService } from '../service';

export const farcasterProfileProvider: Provider = {
  name: 'farcasterProfile',
  description: "Provides information about the agent's Farcaster profile",

  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as FarcasterService;
      const managers = service?.getActiveManagers();

      if (!managers || managers.size === 0) {
        return {
          text: 'Farcaster profile not available.',
          data: { available: false },
        };
      }

      const manager = managers.get(runtime.agentId);
      if (!manager) {
        return {
          text: 'Farcaster profile not available for this agent.',
          data: { available: false },
        };
      }

      const fid = parseInt(runtime.getSetting('FARCASTER_FID') as string, 10);
      if (!fid || isNaN(fid)) {
        return {
          text: 'Invalid Farcaster FID configured.',
          data: { available: false, error: 'Invalid FID' },
        };
      }

      try {
        const profile = await manager.client.getProfile(fid);

        return {
          text: `Your Farcaster profile: @${profile.username} (FID: ${profile.fid}). ${profile.name ? `Display name: ${profile.name}` : ''}`,
          data: {
            available: true,
            fid: profile.fid,
            username: profile.username,
            name: profile.name,
            pfp: profile.pfp,
          },
          values: {
            fid: profile.fid,
            username: profile.username,
          },
        };
      } catch (error) {
        logger.error('[FarcasterProfileProvider] Error fetching profile:', error);
        return {
          text: 'Unable to fetch Farcaster profile at this time.',
          data: { available: false, error: 'Fetch failed' },
        };
      }
    } catch (error) {
      logger.error('[FarcasterProfileProvider] Error:', error);
      return {
        text: 'Farcaster service is not available.',
        data: { available: false },
      };
    }
  },
};
