import { farcasterTimelineProvider } from '../../../providers/timelineProvider';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { FARCASTER_SERVICE_NAME } from '../../../common/constants';
import type { FarcasterService } from '../../../service';

jest.mock('@elizaos/core', () => ({
  ...jest.requireActual('@elizaos/core'),
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('../../../common/constants', () => ({
  FARCASTER_SERVICE_NAME: 'farcaster',
}));

describe('farcasterTimelineProvider', () => {
  let mockRuntime: jest.Mocked<IAgentRuntime>;
  let mockFarcasterService: jest.Mocked<FarcasterService>;
  let mockPostService: any;
  let mockMessage: Memory;
  let mockState: State;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPostService = {
      getPosts: jest.fn(),
    };

    mockFarcasterService = {
      getPostService: jest.fn(),
    } as unknown as jest.Mocked<FarcasterService>;

    mockRuntime = {
      agentId: 'test-agent-id',
      getService: jest.fn(),
    } as unknown as jest.Mocked<IAgentRuntime>;

    mockMessage = {
      id: 'test-message-id',
      content: { text: 'test message' },
      userId: 'test-user-id',
      agentId: 'test-agent-id',
      roomId: 'test-room-id',
      createdAt: Date.now(),
    };

    mockState = {
      userId: 'test-user-id',
      agentId: 'test-agent-id',
      roomId: 'test-room-id',
    } as State;
  });

  describe('provider metadata', () => {
    it('should have correct name and description', () => {
      expect(farcasterTimelineProvider.name).toBe('farcasterTimeline');
      expect(farcasterTimelineProvider.description).toBe(
        "Provides recent casts from the agent's Farcaster timeline"
      );
    });

    it('should have a get method', () => {
      expect(typeof farcasterTimelineProvider.get).toBe('function');
    });
  });

  describe('get method - success scenarios', () => {
    beforeEach(() => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(mockPostService);
    });

    it('should return timeline with multiple casts successfully', async () => {
      const mockCasts = [
        {
          id: 'cast-1',
          username: 'alice',
          text: 'First cast content here',
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: { castHash: 'hash1' },
        },
        {
          id: 'cast-2',
          username: 'bob',
          text: 'Second cast with different content',
          timestamp: new Date('2023-12-01T09:00:00Z'),
          metadata: { castHash: 'hash2' },
        },
        {
          id: 'cast-3',
          username: 'charlie',
          text: 'Third cast from another user',
          timestamp: new Date('2023-12-01T08:00:00Z'),
          metadata: { castHash: 'hash3' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('Recent casts from your timeline:');
      expect(result.text).toContain('@alice');
      expect(result.text).toContain('@bob');
      expect(result.text).toContain('@charlie');
      expect(result.text).toContain('First cast content here');

      expect(result.data).toEqual({
        available: true,
        casts: [
          {
            id: 'cast-1',
            username: 'alice',
            text: 'First cast content here',
            timestamp: mockCasts[0].timestamp,
            castHash: 'hash1',
          },
          {
            id: 'cast-2',
            username: 'bob',
            text: 'Second cast with different content',
            timestamp: mockCasts[1].timestamp,
            castHash: 'hash2',
          },
          {
            id: 'cast-3',
            username: 'charlie',
            text: 'Third cast from another user',
            timestamp: mockCasts[2].timestamp,
            castHash: 'hash3',
          },
        ],
        count: 3,
      });

      expect(result.values).toEqual({
        latestCastHash: 'hash1',
        latestCastText: 'First cast content here',
      });

      expect(mockPostService.getPosts).toHaveBeenCalledWith({
        agentId: 'test-agent-id',
        limit: 5,
      });
    });

    it('should handle single cast correctly', async () => {
      const mockCasts = [
        {
          id: 'single-cast',
          username: 'singleuser',
          text: 'Only one cast here',
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: { castHash: 'singlehash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('1. @singleuser');
      expect(result.data.count).toBe(1);
      expect(result.data.casts).toHaveLength(1);
      expect(result.values.latestCastHash).toBe('singlehash');
      expect(result.values.latestCastText).toBe('Only one cast here');
    });

    it('should handle casts without metadata gracefully', async () => {
      const mockCasts = [
        {
          id: 'no-metadata-cast',
          username: 'nometa',
          text: 'Cast without metadata',
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: undefined,
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.data.casts[0].castHash).toBeUndefined();
      expect(result.values.latestCastHash).toBeUndefined();
      expect(result.values.latestCastText).toBe('Cast without metadata');
    });

    it('should handle casts with null/undefined castHash', async () => {
      const mockCasts = [
        {
          id: 'null-hash-cast',
          username: 'nullhash',
          text: 'Cast with null hash',
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: { castHash: null },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.data.casts[0].castHash).toBeNull();
      expect(result.values.latestCastHash).toBeNull();
    });
  });

  describe('get method - empty data and service unavailable scenarios', () => {
    it('should handle empty casts array', async () => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(mockPostService);
      mockPostService.getPosts.mockResolvedValue([]);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('No recent casts in your timeline.');
      expect(result.data).toEqual({
        available: true,
        casts: [],
        count: 0,
      });
    });

    it('should handle null casts response', async () => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(mockPostService);
      mockPostService.getPosts.mockResolvedValue(null);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('No recent casts in your timeline.');
      expect(result.data).toEqual({
        available: true,
        casts: [],
        count: 0,
      });
    });

    it('should handle undefined casts response', async () => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(mockPostService);
      mockPostService.getPosts.mockResolvedValue(undefined);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('No recent casts in your timeline.');
      expect(result.data).toEqual({
        available: true,
        casts: [],
        count: 0,
      });
    });

    it('should handle when Farcaster service is not available', async () => {
      mockRuntime.getService.mockReturnValue(null as unknown as FarcasterService);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Farcaster timeline not available.');
      expect(result.data).toEqual({
        available: false,
      });
    });

    it('should handle when Farcaster service is undefined', async () => {
      mockRuntime.getService.mockReturnValue(undefined);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Farcaster timeline not available.');
      expect(result.data).toEqual({
        available: false,
      });
    });

    it('should handle when post service is not available', async () => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(null);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Farcaster timeline not available.');
      expect(result.data).toEqual({
        available: false,
      });
    });

    it('should handle when post service is undefined', async () => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(undefined);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Farcaster timeline not available.');
      expect(result.data).toEqual({
        available: false,
      });
    });
  });

  describe('get method - error handling', () => {
    beforeEach(() => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(mockPostService);
    });

    it('should handle getPosts throwing an Error', async () => {
      const errorMessage = 'Network connection failed';
      const error = new Error(errorMessage);
      mockPostService.getPosts.mockRejectedValue(error);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Unable to fetch Farcaster timeline.');
      expect(result.data).toEqual({
        available: false,
        error: errorMessage,
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[FarcasterTimelineProvider] Error:',
        error
      );
    });

    it('should handle getPosts throwing a string error', async () => {
      const errorMessage = 'String error message';
      mockPostService.getPosts.mockRejectedValue(errorMessage);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Unable to fetch Farcaster timeline.');
      expect(result.data).toEqual({
        available: false,
        error: 'Unknown error',
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[FarcasterTimelineProvider] Error:',
        errorMessage
      );
    });

    it('should handle getPosts throwing undefined', async () => {
      mockPostService.getPosts.mockRejectedValue(undefined);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Unable to fetch Farcaster timeline.');
      expect(result.data).toEqual({
        available: false,
        error: 'Unknown error',
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[FarcasterTimelineProvider] Error:',
        undefined
      );
    });

    it('should handle service method throwing during getService call', async () => {
      const serviceError = new Error('Service registry error');
      mockRuntime.getService.mockImplementation(() => {
        throw serviceError;
      });

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Unable to fetch Farcaster timeline.');
      expect(result.data).toEqual({
        available: false,
        error: 'Service registry error',
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[FarcasterTimelineProvider] Error:',
        serviceError
      );
    });

    it('should handle getPostService throwing an error', async () => {
      const postServiceError = new Error('Post service initialization failed');
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockImplementation(() => {
        throw postServiceError;
      });

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toBe('Unable to fetch Farcaster timeline.');
      expect(result.data).toEqual({
        available: false,
        error: 'Post service initialization failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[FarcasterTimelineProvider] Error:',
        postServiceError
      );
    });
  });

  describe('getTimeAgo helper function', () => {
    beforeEach(() => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(mockPostService);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2023-12-01T12:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should show "just now" for recent casts (< 60 seconds)', async () => {
      const mockCasts = [
        {
          id: 'recent-cast',
          username: 'recentuser',
          text: 'Very recent cast',
          timestamp: new Date('2023-12-01T11:59:30Z'),
          metadata: { castHash: 'recenthash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('(just now)');
    });

    it('should show minutes for casts less than 1 hour old', async () => {
      const mockCasts = [
        {
          id: 'minutes-cast',
          username: 'minutesuser',
          text: 'Cast from 30 minutes ago',
          timestamp: new Date('2023-12-01T11:30:00Z'),
          metadata: { castHash: 'minuteshash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('(30m ago)');
    });

    it('should show hours for casts less than 1 day old', async () => {
      const mockCasts = [
        {
          id: 'hours-cast',
          username: 'hoursuser',
          text: 'Cast from 3 hours ago',
          timestamp: new Date('2023-12-01T09:00:00Z'),
          metadata: { castHash: 'hourshash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('(3h ago)');
    });

    it('should show days for casts older than 1 day', async () => {
      const mockCasts = [
        {
          id: 'days-cast',
          username: 'daysuser',
          text: 'Cast from 2 days ago',
          timestamp: new Date('2023-11-29T12:00:00Z'),
          metadata: { castHash: 'dayshash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('(2d ago)');
    });

    it('should handle edge case of exactly 60 seconds', async () => {
      const mockCasts = [
        {
          id: 'sixty-seconds-cast',
          username: 'sixtyuser',
          text: 'Cast from exactly 60 seconds ago',
          timestamp: new Date('2023-12-01T11:59:00Z'),
          metadata: { castHash: 'sixtyhash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('(1m ago)');
    });

    it('should format multiple casts with different time formats', async () => {
      const mockCasts = [
        {
          id: 'cast-1',
          username: 'user1',
          text: 'Recent cast',
          timestamp: new Date('2023-12-01T11:59:45Z'),
          metadata: { castHash: 'hash1' },
        },
        {
          id: 'cast-2',
          username: 'user2',
          text: 'Older cast',
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: { castHash: 'hash2' },
        },
        {
          id: 'cast-3',
          username: 'user3',
          text: 'Ancient cast',
          timestamp: new Date('2023-11-30T12:00:00Z'),
          metadata: { castHash: 'hash3' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('1. @user1 (just now): Recent cast');
      expect(result.text).toContain('2. @user2 (2h ago): Older cast');
      expect(result.text).toContain('3. @user3 (1d ago): Ancient cast');
    });
  });

  describe('edge cases and boundary conditions', () => {
    beforeEach(() => {
      mockRuntime.getService.mockReturnValue(mockFarcasterService);
      mockFarcasterService.getPostService.mockReturnValue(mockPostService);
    });

    it('should handle casts with very long text content', async () => {
      const longText = 'A'.repeat(1000);
      const mockCasts = [
        {
          id: 'long-cast',
          username: 'longuser',
          text: longText,
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: { castHash: 'longhash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain(longText);
      expect(result.data.casts[0].text).toBe(longText);
    });

    it('should handle casts with special characters in text', async () => {
      const specialText = 'Text with emojis 🚀💎 and symbols @#$%^&*()';
      const mockCasts = [
        {
          id: 'special-cast',
          username: 'specialuser',
          text: specialText,
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: { castHash: 'specialhash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain(specialText);
      expect(result.data.casts[0].text).toBe(specialText);
    });

    it('should handle casts with empty text', async () => {
      const mockCasts = [
        {
          id: 'empty-cast',
          username: 'emptyuser',
          text: '',
          timestamp: new Date('2023-12-01T10:00:00Z'),
          metadata: { castHash: 'emptyhash' },
        },
      ];

      mockPostService.getPosts.mockResolvedValue(mockCasts);

      const result = await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(result.text).toContain('@emptyuser');
      expect(result.data.casts[0].text).toBe('');
    });

    it('should verify service is called with correct agent ID', async () => {
      const customAgentId = 'custom-agent-123';
      mockRuntime.agentId = customAgentId;
      mockPostService.getPosts.mockResolvedValue([]);

      await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(mockFarcasterService.getPostService).toHaveBeenCalledWith(
        customAgentId
      );
      expect(mockPostService.getPosts).toHaveBeenCalledWith({
        agentId: customAgentId,
        limit: 5,
      });
    });

    it('should verify correct service name is used', async () => {
      mockPostService.getPosts.mockResolvedValue([]);

      await farcasterTimelineProvider.get(
        mockRuntime,
        mockMessage,
        mockState
      );

      expect(mockRuntime.getService).toHaveBeenCalledWith(
        FARCASTER_SERVICE_NAME
      );
    });
  });
});