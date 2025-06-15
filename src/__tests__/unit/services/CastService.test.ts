import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { createTestUUID } from '../../helpers/mock-utils';
import { FarcasterCastService } from '../../../services/CastService';
import type { FarcasterClient } from '../../../client';
import { logger } from '@elizaos/core';
import { FARCASTER_SOURCE } from '../../../common/constants';

vi.mock('@elizaos/core', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createUniqueUuid: vi.fn(),
}));

vi.mock('../../../common/utils', () => ({
  castUuid: vi.fn(),
  neynarCastToCast: vi.fn(),
}));

// Mock test data
const mockAgentId = createTestUUID('agent-123');
const mockRoomId = 'room-123';
const mockCastHash = '0x123abc';
const mockFid = 12345;

const mockCast = {
  hash: mockCastHash,
  profile: { fid: mockFid, username: 'testuser' },
  text: 'Test cast content',
  timestamp: new Date('2024-01-01T00:00:00Z'),
  threadId: 'thread-123',
  authorFid: mockFid,
  stats: { replies: 5, recasts: 10, likes: 15 },
};

const mockNeynarCast = {
  hash: mockCastHash,
  author: { fid: mockFid, username: 'testuser' },
  text: 'Test cast content',
  timestamp: '2024-01-01T00:00:00Z',
  thread_hash: 'thread-123',
  reactions: { likes_count: 15, recasts_count: 10 },
  replies: { count: 5 },
};

const mockPost = {
  id: 'post-123',
  agentId: mockAgentId,
  roomId: mockRoomId,
  userId: mockFid.toString(),
  username: 'testuser',
  text: 'Test cast content',
  timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
  media: [],
  metadata: {
    castHash: mockCastHash,
    threadId: 'thread-123',
    authorFid: mockFid,
    source: FARCASTER_SOURCE,
  },
};

const mockFarcasterClient = {
  sendCast: vi.fn(),
  getTimeline: vi.fn(),
  getCast: vi.fn(),
  getMentions: vi.fn(),
} as unknown as FarcasterClient;

const mockRuntime = { config: { FARCASTER_FID: mockFid } };

// Mock utility functions
const mockCastUuid = vi.fn();
const mockNeynarCastToCast = vi.fn();
const mockCreateUniqueUuid = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockCastUuid.mockReturnValue('post-123');
  mockNeynarCastToCast.mockReturnValue(mockCast);
  mockCreateUniqueUuid.mockReturnValue(mockRoomId);
});

describe('FarcasterCastService', () => {
  let castService: FarcasterCastService;

  beforeEach(() => {
    castService = new FarcasterCastService(mockFarcasterClient, mockRuntime);
  });

  describe('constructor', () => {
    test('should initialize CastService with client and runtime', () => {
      expect(castService).toBeInstanceOf(FarcasterCastService);
      expect(castService).toBeDefined();
    });

    test('should accept FarcasterClient and runtime parameters', () => {
      const service = new FarcasterCastService(mockFarcasterClient, mockRuntime);
      expect(service).toBeInstanceOf(FarcasterCastService);
    });
  });

  describe('createPost', () => {
    const createPostOptions = {
      agentId: mockAgentId,
      roomId: mockRoomId,
      text: 'Test post content',
      media: [],
    };

    test('should create post successfully', async () => {
      mockFarcasterClient.sendCast.mockResolvedValue([mockNeynarCast]);

      const result = await castService.createPost(createPostOptions);

      expect(result).toEqual(mockPost);
      expect(mockFarcasterClient.sendCast).toHaveBeenCalledWith({
        content: { text: 'Test post content' },
        inReplyTo: undefined,
      });
      expect(mockNeynarCastToCast).toHaveBeenCalledWith(mockNeynarCast);
    });

    test('should create post with reply', async () => {
      const optionsWithReply = {
        ...createPostOptions,
        inReplyTo: 'parent-cast-hash',
      };
      mockFarcasterClient.sendCast.mockResolvedValue([mockNeynarCast]);

      await castService.createPost(optionsWithReply);

      expect(mockFarcasterClient.sendCast).toHaveBeenCalledWith({
        content: { text: 'Test post content' },
        inReplyTo: { hash: 'parent-cast-hash', fid: mockFid },
      });
    });

    test('should throw error when no cast is created', async () => {
      mockFarcasterClient.sendCast.mockResolvedValue([]);

      await expect(castService.createPost(createPostOptions)).rejects.toThrow('No cast was created');
    });

    test('should handle sendCast API errors', async () => {
      const apiError = new Error('API Error');
      mockFarcasterClient.sendCast.mockRejectedValue(apiError);

      await expect(castService.createPost(createPostOptions)).rejects.toThrow('API Error');
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error creating cast:', apiError);
    });

    test('should handle empty text content', async () => {
      const optionsWithEmptyText = { ...createPostOptions, text: '' };
      mockFarcasterClient.sendCast.mockResolvedValue([mockNeynarCast]);

      const result = await castService.createPost(optionsWithEmptyText);

      expect(result).toBeDefined();
      expect(mockFarcasterClient.sendCast).toHaveBeenCalledWith({
        content: { text: '' },
        inReplyTo: undefined,
      });
    });

    test('should handle very long text content', async () => {
      const longText = 'a'.repeat(1000);
      const optionsWithLongText = { ...createPostOptions, text: longText };
      mockFarcasterClient.sendCast.mockResolvedValue([mockNeynarCast]);

      await castService.createPost(optionsWithLongText);

      expect(mockFarcasterClient.sendCast).toHaveBeenCalledWith({
        content: { text: longText },
        inReplyTo: undefined,
      });
    });
  });

  describe('getPosts', () => {
    const getPostsOptions = { agentId: mockAgentId, roomId: mockRoomId, limit: 20 };

    test('should get posts successfully', async () => {
      const mockTimeline = [mockNeynarCast, { ...mockNeynarCast, hash: '0x456def' }];
      mockFarcasterClient.getTimeline.mockResolvedValue({
        timeline: mockTimeline,
        nextCursor: 'cursor-123',
      });

      const result = await castService.getPosts(getPostsOptions);

      expect(result).toHaveLength(2);
      expect(mockFarcasterClient.getTimeline).toHaveBeenCalledWith({
        fid: mockFid,
        pageSize: 20,
      });
    });

    test('should get posts without roomId filter', async () => {
      const optionsWithoutRoomId = { agentId: mockAgentId, limit: 10 };
      mockFarcasterClient.getTimeline.mockResolvedValue({
        timeline: [mockNeynarCast],
        nextCursor: null,
      });

      const result = await castService.getPosts(optionsWithoutRoomId);

      expect(result).toHaveLength(1);
      expect(mockFarcasterClient.getTimeline).toHaveBeenCalledWith({
        fid: mockFid,
        pageSize: 10,
      });
    });

    test('should use default limit when not specified', async () => {
      const optionsWithoutLimit = { agentId: mockAgentId };
      mockFarcasterClient.getTimeline.mockResolvedValue({
        timeline: [],
        nextCursor: null,
      });

      await castService.getPosts(optionsWithoutLimit);

      expect(mockFarcasterClient.getTimeline).toHaveBeenCalledWith({
        fid: mockFid,
        pageSize: 20,
      });
    });

    test('should handle getTimeline API errors gracefully', async () => {
      mockFarcasterClient.getTimeline.mockRejectedValue(new Error('Timeline error'));

      const result = await castService.getPosts(getPostsOptions);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching casts:', expect.any(Error));
    });

    test('should handle empty timeline', async () => {
      mockFarcasterClient.getTimeline.mockResolvedValue({
        timeline: [],
        nextCursor: null,
      });

      const result = await castService.getPosts(getPostsOptions);

      expect(result).toEqual([]);
    });
  });

  describe('getPost', () => {
    test('should get single post successfully', async () => {
      mockFarcasterClient.getCast.mockResolvedValue(mockNeynarCast);

      const result = await castService.getPost(mockCastHash, mockAgentId);

      expect(result).toEqual(expect.objectContaining({
        id: 'post-123',
        agentId: mockAgentId,
        text: 'Test cast content',
      }));
      expect(mockFarcasterClient.getCast).toHaveBeenCalledWith(mockCastHash);
    });

    test('should return null when cast not found', async () => {
      mockFarcasterClient.getCast.mockRejectedValue(new Error('Cast not found'));

      const result = await castService.getPost('nonexistent-hash', mockAgentId);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching cast:', expect.any(Error));
    });

    test('should handle invalid cast hash', async () => {
      mockFarcasterClient.getCast.mockRejectedValue(new Error('Invalid hash format'));

      const result = await castService.getPost('invalid-hash', mockAgentId);

      expect(result).toBeNull();
    });

    test('should handle empty cast hash', async () => {
      mockFarcasterClient.getCast.mockRejectedValue(new Error('Empty hash'));

      const result = await castService.getPost('', mockAgentId);

      expect(result).toBeNull();
    });
  });

  describe('deletePost', () => {
    test('should log warning for unsupported delete operation', async () => {
      await castService.deletePost(mockCastHash, mockAgentId);
      expect(logger.warn).toHaveBeenCalledWith('[Farcaster] Cast deletion is not supported by the Farcaster API');
    });
  });

  describe('likePost', () => {
    test('should log info for not yet implemented like functionality', async () => {
      await castService.likePost(mockCastHash, mockAgentId);
      expect(logger.info).toHaveBeenCalledWith(`[Farcaster] Like functionality not yet implemented for cast: ${mockCastHash}`);
    });

    test('should handle errors gracefully', async () => {
      const originalLog = logger.info;
      logger.info = vi.fn().mockImplementation(() => { throw new Error('Test error'); });
      await expect(castService.likePost(mockCastHash, mockAgentId)).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error liking cast:', expect.any(Error));
      logger.info = originalLog;
    });
  });

  describe('unlikePost', () => {
    test('should log info for not yet implemented unlike functionality', async () => {
      await castService.unlikePost(mockCastHash, mockAgentId);
      expect(logger.info).toHaveBeenCalledWith(`[Farcaster] Unlike functionality not yet implemented for cast: ${mockCastHash}`);
    });

    test('should handle errors gracefully', async () => {
      const originalLog = logger.info;
      logger.info = vi.fn().mockImplementation(() => { throw new Error('Test error'); });
      await expect(castService.unlikePost(mockCastHash, mockAgentId)).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error unliking cast:', expect.any(Error));
      logger.info = originalLog;
    });
  });

  describe('repost', () => {
    test('should log info for not yet implemented recast functionality', async () => {
      await castService.repost(mockCastHash, mockAgentId);
      expect(logger.info).toHaveBeenCalledWith(`[Farcaster] Recast functionality not yet implemented for cast: ${mockCastHash}`);
    });

    test('should handle errors gracefully', async () => {
      const originalLog = logger.info;
      logger.info = vi.fn().mockImplementation(() => { throw new Error('Test error'); });
      await expect(castService.repost(mockCastHash, mockAgentId)).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error recasting:', expect.any(Error));
      logger.info = originalLog;
    });
  });

  describe('unrepost', () => {
    test('should log info for not yet implemented unrecast functionality', async () => {
      await castService.unrepost(mockCastHash, mockAgentId);
      expect(logger.info).toHaveBeenCalledWith(`[Farcaster] Remove recast functionality not yet implemented for cast: ${mockCastHash}`);
    });

    test('should handle errors gracefully', async () => {
      const originalLog = logger.info;
      logger.info = vi.fn().mockImplementation(() => { throw new Error('Test error'); });
      await expect(castService.unrepost(mockCastHash, mockAgentId)).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error removing recast:', expect.any(Error));
      logger.info = originalLog;
    });
  });

  describe('getMentions', () => {
    test('should get mentions successfully', async () => {
      const mockMentions = [mockNeynarCast, { ...mockNeynarCast, hash: '0x789ghi' }];
      mockFarcasterClient.getMentions.mockResolvedValue(mockMentions);
      const result = await castService.getMentions(mockAgentId);
      expect(result).toHaveLength(2);
      expect(mockFarcasterClient.getMentions).toHaveBeenCalledWith({ fid: mockFid, pageSize: 20 });
    });

    test('should get mentions with custom limit', async () => {
      mockFarcasterClient.getMentions.mockResolvedValue([mockNeynarCast]);
      const result = await castService.getMentions(mockAgentId, { limit: 10 });
      expect(result).toHaveLength(1);
      expect(mockFarcasterClient.getMentions).toHaveBeenCalledWith({ fid: mockFid, pageSize: 10 });
    });

    test('should handle getMentions API errors gracefully', async () => {
      mockFarcasterClient.getMentions.mockRejectedValue(new Error('Mentions error'));
      const result = await castService.getMentions(mockAgentId);
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching mentions:', expect.any(Error));
    });

    test('should handle empty mentions list', async () => {
      mockFarcasterClient.getMentions.mockResolvedValue([]);
      const result = await castService.getMentions(mockAgentId);
      expect(result).toEqual([]);
    });
  });

  describe('castToPost conversion', () => {
    test('should convert cast to post format correctly', async () => {
      mockFarcasterClient.getCast.mockResolvedValue(mockNeynarCast);
      const result = await castService.getPost(mockCastHash, mockAgentId);
      expect(result).toEqual({
        id: 'post-123',
        agentId: mockAgentId,
        roomId: mockRoomId,
        userId: mockFid.toString(),
        username: 'testuser',
        text: 'Test cast content',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        media: [],
        metadata: { castHash: mockCastHash, threadId: 'thread-123', authorFid: mockFid, source: FARCASTER_SOURCE, stats: mockCast.stats },
      });
    });
  });

  describe('integration scenarios', () => {
    test('should maintain consistency between createPost and getPost', async () => {
      mockFarcasterClient.sendCast.mockResolvedValue([mockNeynarCast]);
      mockFarcasterClient.getCast.mockResolvedValue(mockNeynarCast);
      const createOptions = { agentId: mockAgentId, roomId: mockRoomId, text: 'Test post content' };
      const createdPost = await castService.createPost(createOptions);
      const retrievedPost = await castService.getPost(createdPost.metadata.castHash, mockAgentId);
      expect(retrievedPost).toBeDefined();
      expect(retrievedPost?.text).toBe(createdPost.text);
      expect(retrievedPost?.agentId).toBe(createdPost.agentId);
    });

    test('should handle concurrent operations', async () => {
      mockFarcasterClient.getTimeline.mockResolvedValue({ timeline: [mockNeynarCast], nextCursor: null });
      const promises = Array(5).fill(null).map(() => castService.getPosts({ agentId: mockAgentId }));
      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      expect(results.every(res => res.length === 1)).toBe(true);
    });
  });

  describe('error handling and edge cases', () => {
    test('should handle null/undefined inputs gracefully', async () => {
      await expect(castService.getPost(null as any, mockAgentId)).rejects.toThrow();
      await expect(castService.getPost(mockCastHash, null as any)).rejects.toThrow();
    });

    test('should handle network timeouts', async () => {
      mockFarcasterClient.getTimeline.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 100))
      );
      const result = await castService.getPosts({ agentId: mockAgentId });
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching casts:', expect.any(Error));
    });
  });
});