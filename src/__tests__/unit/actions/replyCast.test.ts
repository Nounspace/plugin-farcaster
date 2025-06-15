import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { replyCastAction } from '../../../actions/replyCast';
import { logger } from '@elizaos/core';
import { FARCASTER_SERVICE_NAME } from '../../../common/constants';
import { FarcasterMessageType } from '../../../common/types';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

// Mock external dependencies
vi.mock('@elizaos/core', async () => {
  const actual = await vi.importActual('@elizaos/core');
  return {
    ...actual,
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

describe('replyCastAction', () => {
  let mockRuntime: IAgentRuntime;
  let mockMessageService: any;
  let mockFarcasterService: any;
  let mockMessage: Memory;
  let mockState: State;

  beforeEach(() => {
    vi.clearAllMocks();

    mockMessageService = {
      sendMessage: vi.fn().mockResolvedValue({ id: 'reply-123' }),
    };

    mockFarcasterService = {
      getMessageService: vi.fn().mockReturnValue(mockMessageService),
    };

    mockRuntime = {
      agentId: 'test-agent-123',
      getService: vi.fn().mockReturnValue(mockFarcasterService),
      useModel: vi.fn().mockResolvedValue({ text: 'Generated reply content' }),
    } as unknown as IAgentRuntime;

    mockMessage = {
      content: {
        text: 'Please reply to this cast',
        metadata: {
          parentCastHash: 'parent-hash-123',
        },
      },
      roomId: 'room-123',
    } as Memory;

    mockState = {
      parentCastHash: 'state-parent-hash-456',
      replyContent: 'Pre-generated reply content',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Action Structure', () => {
    it('should have correct name', () => {
      expect(replyCastAction.name).toBe('REPLY_TO_CAST');
    });

    it('should have description', () => {
      expect(replyCastAction.description).toBe('Replies to a cast on Farcaster');
    });

    it('should have examples array', () => {
      expect(Array.isArray(replyCastAction.examples)).toBe(true);
      expect(replyCastAction.examples.length).toBeGreaterThan(0);
    });

    it('should have validate function', () => {
      expect(typeof replyCastAction.validate).toBe('function');
    });

    it('should have handler function', () => {
      expect(typeof replyCastAction.handler).toBe('function');
    });
  });

  describe('Validation', () => {
    describe('Happy Path', () => {
      it('should validate when message contains reply keywords and has parent cast', async () => {
        const result = await replyCastAction.validate(mockRuntime, mockMessage);
        expect(result).toBe(true);
      });

      it('should validate with different reply keywords', async () => {
        const keywords = ['reply', 'respond', 'answer', 'comment'];

        for (const keyword of keywords) {
          const testMessage = {
            ...mockMessage,
            content: {
              ...mockMessage.content,
              text: `Please ${keyword} to this message`,
            },
          };
          const result = await replyCastAction.validate(mockRuntime, testMessage);
          expect(result).toBe(true);
        }
      });

      it('should validate when service is available even without parent cast', async () => {
        const messageWithoutParent = {
          ...mockMessage,
          content: {
            text: 'Please reply to this',
            metadata: {},
          },
        };
        const result = await replyCastAction.validate(mockRuntime, messageWithoutParent);
        expect(result).toBe(true);
      });
    });

    describe('Edge Cases', () => {
      it('should handle case-insensitive keyword matching', async () => {
        const testMessage = {
          ...mockMessage,
          content: {
            ...mockMessage.content,
            text: 'Please REPLY to this COMMENT',
          },
        };
        const result = await replyCastAction.validate(mockRuntime, testMessage);
        expect(result).toBe(true);
      });

      it('should handle empty text content', async () => {
        const testMessage = {
          ...mockMessage,
          content: { ...mockMessage.content, text: '' },
        };
        const result = await replyCastAction.validate(mockRuntime, testMessage);
        expect(result).toBe(false);
      });

      it('should handle undefined text content', async () => {
        const testMessage = {
          ...mockMessage,
          content: { ...mockMessage.content, text: undefined },
        };
        const result = await replyCastAction.validate(mockRuntime, testMessage);
        expect(result).toBe(false);
      });

      it('should handle missing metadata', async () => {
        const testMessage = {
          ...mockMessage,
          content: { text: 'Please reply to this' },
        };
        mockFarcasterService.getMessageService.mockReturnValue(null);
        const result = await replyCastAction.validate(mockRuntime, testMessage);
        expect(result).toBe(false);
      });
    });

    describe('Service Availability', () => {
      it('should return false when Farcaster service is unavailable', async () => {
        mockRuntime.getService = vi.fn().mockReturnValue(null);
        const testMessage = {
          ...mockMessage,
          content: { text: 'Please reply to this', metadata: {} },
        };
        const result = await replyCastAction.validate(mockRuntime, testMessage);
        expect(result).toBe(false);
      });

      it('should return false when message service is unavailable', async () => {
        mockFarcasterService.getMessageService.mockReturnValue(null);
        const testMessage = {
          ...mockMessage,
          content: { text: 'Please reply to this', metadata: {} },
        };
        const result = await replyCastAction.validate(mockRuntime, testMessage);
        expect(result).toBe(false);
      });
    });
  });

  describe('Handler - Success Cases', () => {
    it('should successfully reply to cast with metadata parent hash', async () => {
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith({
        agentId: 'test-agent-123',
        roomId: 'room-123',
        text: 'Generated reply content',
        type: FarcasterMessageType.REPLY,
        replyToId: 'parent-hash-123',
        metadata: { parentHash: 'parent-hash-123' },
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[REPLY_TO_CAST] Successfully replied to cast: reply-123'
      );
    });

    it('should use state parent hash when message metadata is missing', async () => {
      const messageWithoutParent = {
        ...mockMessage,
        content: { ...mockMessage.content, metadata: {} },
      };
      const result = await replyCastAction.handler(mockRuntime, messageWithoutParent, mockState);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          replyToId: 'state-parent-hash-456',
          metadata: { parentHash: 'state-parent-hash-456' },
        })
      );
    });

    it('should use pre-generated reply content from state', async () => {
      const result = await replyCastAction.handler(mockRuntime, mockMessage, mockState);
      expect(result).toBe(true);
      expect(mockRuntime.useModel).not.toHaveBeenCalled();
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Pre-generated reply content' })
      );
    });

    it('should generate content using AI model when not provided in state', async () => {
      const stateWithoutContent = { ...mockState };
      delete stateWithoutContent.replyContent;
      const result = await replyCastAction.handler(mockRuntime, mockMessage, stateWithoutContent);
      expect(result).toBe(true);
      expect(mockRuntime.useModel).toHaveBeenCalledWith('text_large', {
        prompt:
          'Based on this request: "Please reply to this cast", generate a helpful and engaging reply for a Farcaster cast (max 320 characters).',
      });
    });

    it('should handle string response from AI model', async () => {
      mockRuntime.useModel = vi.fn().mockResolvedValue('Direct string response');
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Direct string response' })
      );
    });

    it('should truncate content that exceeds 320 characters', async () => {
      const longContent = 'A'.repeat(350);
      mockRuntime.useModel = vi.fn().mockResolvedValue({ text: longContent });
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'A'.repeat(317) + '...' })
      );
    });

    it('should handle exactly 320 character content', async () => {
      const exactContent = 'A'.repeat(320);
      mockRuntime.useModel = vi.fn().mockResolvedValue({ text: exactContent });
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: exactContent })
      );
    });
  });

  describe('Handler - Error Cases', () => {
    it('should return false when message service is unavailable', async () => {
      mockFarcasterService.getMessageService.mockReturnValue(null);
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[REPLY_TO_CAST] MessageService not available'
      );
    });

    it('should return false when Farcaster service is unavailable', async () => {
      mockRuntime.getService = vi.fn().mockReturnValue(null);
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[REPLY_TO_CAST] MessageService not available'
      );
    });

    it('should return false when no parent cast hash is available', async () => {
      const messageWithoutParent = {
        ...mockMessage,
        content: { ...mockMessage.content, metadata: {} },
      };
      const result = await replyCastAction.handler(mockRuntime, messageWithoutParent);
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[REPLY_TO_CAST] No parent cast to reply to'
      );
    });

    it('should handle AI model errors gracefully', async () => {
      mockRuntime.useModel = vi.fn().mockRejectedValue(new Error('AI model failed'));
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[REPLY_TO_CAST] Error replying to cast:',
        expect.any(Error)
      );
    });

    it('should handle message service sendMessage errors', async () => {
      mockMessageService.sendMessage.mockRejectedValue(new Error('Send message failed'));
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[REPLY_TO_CAST] Error replying to cast:',
        expect.any(Error)
      );
    });

    it('should handle empty AI model response', async () => {
      mockRuntime.useModel = vi.fn().mockResolvedValue({ text: '' });
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: '' })
      );
    });

    it('should handle AI model response without text property', async () => {
      mockRuntime.useModel = vi.fn().mockResolvedValue({});
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: '' })
      );
    });

    it('should handle null AI model response', async () => {
      mockRuntime.useModel = vi.fn().mockResolvedValue(null);
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[REPLY_TO_CAST] Error replying to cast:',
        expect.any(Error)
      );
    });
  });

  describe('Integration Edge Cases', () => {
    it('should handle concurrent reply attempts', async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => replyCastAction.handler(mockRuntime, mockMessage));
      const results = await Promise.all(promises);
      expect(results.every((r) => r === true)).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledTimes(5);
    });

    it('should handle special characters in reply content', async () => {
      const specialContent = '🎉 Hello @user #hashtag https://example.com 中文 ñoño';
      mockRuntime.useModel = vi.fn().mockResolvedValue({ text: specialContent });
      const result = await replyCastAction.handler(mockRuntime, mockMessage);
      expect(result).toBe(true);
      expect(mockMessageService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: specialContent })
      );
    });

    it('should validate service calls with correct parameters', async () => {
      await replyCastAction.handler(mockRuntime, mockMessage);
      expect(mockRuntime.getService).toHaveBeenCalledWith(FARCASTER_SERVICE_NAME);
      expect(mockFarcasterService.getMessageService).toHaveBeenCalledWith('test-agent-123');
    });
  });
});