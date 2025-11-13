import { FarcasterService } from './service.js';
import { FarcasterTestSuite } from './__tests__/suite.js';
import { farcasterActions } from './actions/index.js';
import { farcasterProviders } from './providers/index.js';
import { farcasterWebhookRoutes } from './routes/webhook.js';
import { FarcasterEventTypes } from './common/types.js';
import { IAgentRuntime } from '@elizaos/core';

const farcasterPlugin = {
  name: 'farcaster',
  description: 'Farcaster client plugin for sending and receiving casts',
  services: [FarcasterService],
  actions: farcasterActions,
  providers: farcasterProviders,
  routes: farcasterWebhookRoutes,
  tests: [new FarcasterTestSuite()],
  events: {
    [FarcasterEventTypes.STREAM_CAST_RECEIVED]: [
      async (payload: { runtime: IAgentRuntime, cast: any }) => {
        const { runtime, cast } = payload;
        const service = runtime.getService(FarcasterService.serviceType) as FarcasterService;
        const manager = service.getActiveManagers().get(runtime.agentId);

        if (!manager) {
          return;
        }

        const config = manager.interactions.config;
        const agentFid = config.FARCASTER_FID;
        const isMention = cast.mentioned_profiles?.some((p: any) => p.fid === agentFid);
        const isReply = cast.parent_author?.fid === agentFid;

        const targetChannels = (config.FARCASTER_TARGET_CHANNELS || '').split(',').filter(Boolean);
        const targetUsers = (config.FARCASTER_TARGET_USERS || '').split(',').map(Number).filter(Boolean);
        const targetRegex = config.FARCASTER_TARGET_REGEX ? new RegExp(config.FARCASTER_TARGET_REGEX) : null;

        const parentUrl = cast.parent_url;
        const authorFid = cast.author.fid;
        const text = cast.text;

        const shouldProcess =
            isMention ||
            isReply ||
            (parentUrl && targetChannels.some(channel => parentUrl.includes(channel))) ||
            (targetUsers.includes(authorFid) && (!targetRegex || targetRegex.test(text)));

        if (shouldProcess) {
          manager.interactions.processStreamedCast(cast);
        }
      }
    ]
  }
};

export default farcasterPlugin;
