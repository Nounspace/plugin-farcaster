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

export const farcasterTimelineProvider: Provider = {
  name: 'farcasterTimeline',
  description: "Provides recent casts from the agent's Farcaster timeline",

  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as FarcasterService;
      const postService = service?.getPostService(runtime.agentId);

      if (!postService) {
        return {
          text: 'Farcaster timeline not available.',
          data: { available: false },
        };
      }

      // Get recent posts from timeline
      const posts = await postService.getPosts({
        agentId: runtime.agentId,
        limit: 5,
      });

      if (!posts || posts.length === 0) {
        return {
          text: 'No recent casts in your timeline.',
          data: {
            available: true,
            posts: [],
            count: 0,
          },
        };
      }

      // Format posts for context
      const formattedPosts = posts
        .map((post, index) => {
          const timeAgo = getTimeAgo(new Date(post.timestamp));
          return `${index + 1}. @${post.username} (${timeAgo}): ${post.text}`;
        })
        .join('\n');

      return {
        text: `Recent casts from your timeline:\n${formattedPosts}`,
        data: {
          available: true,
          posts: posts.map((p) => ({
            id: p.id,
            username: p.username,
            text: p.text,
            timestamp: p.timestamp,
            castHash: p.metadata?.castHash,
          })),
          count: posts.length,
        },
        values: {
          latestCastHash: posts[0]?.metadata?.castHash,
          latestCastText: posts[0]?.text,
        },
      };
    } catch (error) {
      logger.error('[FarcasterTimelineProvider] Error:', error);
      return {
        text: 'Unable to fetch Farcaster timeline.',
        data: { available: false, error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  },
};

// Helper function to format time ago
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
