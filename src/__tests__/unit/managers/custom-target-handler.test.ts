import { describe, it, expect, vi } from 'vitest';
import { handleCustomTargetUserCast } from '../../../managers/custom-target-handler';
import { ModelType, type IAgentRuntime } from '@elizaos/core';
import type { FarcasterClient } from '../../../client';
import { Cast, FarcasterConfig } from '../../../common/types';

describe('handleCustomTargetUserCast', () => {
  it('should use custom provider and model if defined', async () => {
    const mockRuntime = {
      useModel: vi.fn().mockResolvedValue('mocked response'),
      character: {
        templates: {
          'test-prompt': 'test prompt with {{historyConversation}}',
        },
      },
    } as unknown as IAgentRuntime;

    const mockClient = {
      getProfile: vi.fn().mockResolvedValue({
        username: 'originalUser',
        score: 1.0,
      }),
      neynar: {
        lookupCastConversation: vi.fn().mockResolvedValue({
          cast: {
            hash: '0x123',
            author: { username: 'testuser' },
            text: 'hello world',
            direct_replies: [],
          },
        }),
      },
      sendCast: vi.fn(),
    } as unknown as FarcasterClient;

    const cast: Cast = {
      hash: '0x123',
      authorFid: 1,
      username: 'testuser',
      text: 'hello world',
      inReplyTo: { fid: 2, hash: '0x456', username: 'parent' },
      timestamp: new Date(),
      type: 'user',
    };

    const targetConfig = {
      fid: 1,
      trigger: { username: 'testuser' },
      promptTemplateKey: 'test-prompt',
      extractions: [],
      replyTo: 'self' as const,
      custom_provider: 'groq',
    };

    const config: Partial<FarcasterConfig> = {
      MIN_NEYNAR_SCORE: 0.5,
    };

    await handleCustomTargetUserCast(cast, targetConfig as any, mockRuntime, mockClient, config as FarcasterConfig);

    expect(mockRuntime.useModel).toHaveBeenCalledWith(
      ModelType.LARGE,
      { prompt: 'test prompt with @testuser: hello world\n' },
      'groq'
    );
  });
});
