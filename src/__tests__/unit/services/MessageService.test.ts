import { FarcasterMessageService } from '../../../services/MessageService';
import { logger, createUniqueUuid } from '@elizaos/core';
import { castUuid, neynarCastToCast } from '../../../common/utils';
import { FarcasterMessageType } from '../../../common/types';

// Mock dependencies
jest.mock('@elizaos/core', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  createUniqueUuid: jest.fn(),
}));

jest.mock('../../../common/utils', () => ({
  castUuid: jest.fn(),
  neynarCastToCast: jest.fn(),
}));

describe('FarcasterMessageService', () => {
  let messageService: FarcasterMessageService;
  let mockClient: any;
  let mockRuntime: any;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Setup mock client
    mockClient = {
      getTimeline: jest.fn(),
      sendCast: jest.fn(),
      getCast: jest.fn(),
    };

    // Setup mock runtime
    mockRuntime = {
      agentId: 'test-agent-id',
      getSetting: jest.fn(),
      config: {
        FARCASTER_FID: '12345',
      },
      emitEvent: jest.fn(),
    };

    messageService = new FarcasterMessageService(mockClient, mockRuntime);
  });

  describe('getMessages', () => {
    const mockTimeline = [
      {
        hash: 'cast-hash-1',
        threadId: 'thread-1',
        profile: { fid: 123, username: 'testuser' },
        text: 'Test message 1',
        timestamp: new Date('2023-01-01'),
        authorFid: 123,
        inReplyTo: null,
      },
      {
        hash: 'cast-hash-2',
        threadId: 'thread-2',
        profile: { fid: 456, username: 'testuser2' },
        text: 'Test message 2',
        timestamp: new Date('2023-01-02'),
        authorFid: 456,
        inReplyTo: { hash: 'parent-hash', fid: 123 },
      },
    ];

    beforeEach(() => {
      mockClient.getTimeline.mockResolvedValue({ timeline: mockTimeline });
      (createUniqueUuid as jest.Mock).mockImplementation((runtime, id) => `unique-${id}`);
      (castUuid as jest.Mock).mockImplementation(({ hash, agentId }) => `cast-uuid-${hash}-${agentId}`);
    });

    it('should return messages successfully with default limit', async () => {
      const result = await messageService.getMessages({});

      expect(mockClient.getTimeline).toHaveBeenCalledWith({
        fid: 12345,
        pageSize: 20,
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: expect.any(String),
        agentId: 'test-agent-id',
        roomId: expect.any(String),
        userId: '123',
        username: 'testuser',
        text: 'Test message 1',
        type: FarcasterMessageType.CAST,
        timestamp: expect.any(Number),
        inReplyTo: undefined,
      });
    });

    it('should filter messages by roomId when provided', async () => {
      const targetRoomId = 'unique-thread-1';
      (createUniqueUuid as jest.Mock).mockImplementation((runtime, id) =>
        id === 'thread-1' ? targetRoomId : `unique-${id}`
      );

      const result = await messageService.getMessages({ roomId: targetRoomId });

      expect(result).toHaveLength(1);
      expect(result[0].roomId).toBe(targetRoomId);
    });

    it('should apply custom limit when provided', async () => {
      await messageService.getMessages({ limit: 10 });

      expect(mockClient.getTimeline).toHaveBeenCalledWith({
        fid: 12345,
        pageSize: 10,
      });
    });

    it('should handle reply messages correctly', async () => {
      const result = await messageService.getMessages({});

      expect(result[1].type).toBe(FarcasterMessageType.REPLY);
      expect(result[1].inReplyTo).toBeDefined();
    });

    it('should handle empty timeline', async () => {
      mockClient.getTimeline.mockResolvedValue({ timeline: [] });

      const result = await messageService.getMessages({});

      expect(result).toHaveLength(0);
    });

    it('should handle client error and return empty array', async () => {
      mockClient.getTimeline.mockRejectedValue(new Error('Network error'));

      const result = await messageService.getMessages({});

      expect(result).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching messages:', expect.any(Error));
    });

    it('should use runtime.getSetting when available', async () => {
      mockRuntime.getSetting.mockReturnValue('67890');

      await messageService.getMessages({});

      expect(mockClient.getTimeline).toHaveBeenCalledWith({
        fid: 67890,
        pageSize: 20,
      });
    });

    it('should handle missing FARCASTER_FID gracefully', async () => {
      mockRuntime.getSetting.mockReturnValue(null);
      mockRuntime.config.FARCASTER_FID = undefined;

      await messageService.getMessages({});

      expect(mockClient.getTimeline).toHaveBeenCalledWith({
        fid: NaN,
        pageSize: 20,
      });
    });
  });

  describe('sendMessage', () => {
    const mockCast = {
      hash: 'new-cast-hash',
      threadId: 'new-thread',
      profile: { fid: 12345, username: 'agent' },
      text: 'New message',
      timestamp: new Date('2023-01-03'),
      authorFid: 12345,
      inReplyTo: null,
    };

    beforeEach(() => {
      mockClient.sendCast.mockResolvedValue([mockCast]);
      (neynarCastToCast as jest.Mock).mockReturnValue(mockCast);
      (castUuid as jest.Mock).mockImplementation(({ hash, agentId }) => `cast-uuid-${hash}-${agentId}`);
    });

    it('should send a new cast successfully', async () => {
      const sendOptions = {
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: 'Hello world',
        type: FarcasterMessageType.CAST,
      };

      const result = await messageService.sendMessage(sendOptions);

      expect(mockClient.sendCast).toHaveBeenCalledWith({
        content: { text: 'Hello world' },
        inReplyTo: undefined,
      });
      expect(result).toMatchObject({
        id: expect.any(String),
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: 'Hello world',
        type: FarcasterMessageType.CAST,
        timestamp: expect.any(Number),
      });
      expect(mockRuntime.emitEvent).toHaveBeenCalledWith('FARCASTER_CAST_SENT', expect.any(Object));
    });

    it('should send a reply cast with correct inReplyTo', async () => {
      const sendOptions = {
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: 'Reply message',
        type: FarcasterMessageType.REPLY,
        replyToId: 'parent-message-id',
        metadata: { parentHash: 'parent-hash' },
      };

      const result = await messageService.sendMessage(sendOptions);

      expect(mockClient.sendCast).toHaveBeenCalledWith({
        content: { text: 'Reply message' },
        inReplyTo: { hash: 'parent-hash', fid: 12345 },
      });
      expect(result.type).toBe(FarcasterMessageType.REPLY);
      expect(result.inReplyTo).toBeDefined();
    });

    it('should handle empty cast array response', async () => {
      mockClient.sendCast.mockResolvedValue([]);

      const sendOptions = {
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: 'Test message',
        type: FarcasterMessageType.CAST,
      };

      await expect(messageService.sendMessage(sendOptions)).rejects.toThrow('No cast was created');
    });

    it('should handle client error when sending cast', async () => {
      mockClient.sendCast.mockRejectedValue(new Error('Send failed'));

      const sendOptions = {
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: 'Test message',
        type: FarcasterMessageType.CAST,
      };

      await expect(messageService.sendMessage(sendOptions)).rejects.toThrow('Send failed');
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error sending message:', expect.any(Error));
    });

    it('should handle reply without parentHash in metadata', async () => {
      const sendOptions = {
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: 'Reply message',
        type: FarcasterMessageType.REPLY,
        replyToId: 'parent-message-id',
      };

      const result = await messageService.sendMessage(sendOptions);

      expect(mockClient.sendCast).toHaveBeenCalledWith({
        content: { text: 'Reply message' },
        inReplyTo: { hash: 'parent-message-id', fid: 12345 },
      });
    });

    it('should preserve additional metadata in result', async () => {
      const sendOptions = {
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: 'Test message',
        type: FarcasterMessageType.CAST,
        metadata: { customField: 'customValue' },
      };

      const result = await messageService.sendMessage(sendOptions);

      expect(result.metadata).toMatchObject({
        customField: 'customValue',
        castHash: 'new-cast-hash',
        threadId: 'new-thread',
        authorFid: 12345,
      });
    });
  });

  describe('getMessage', () => {
    const mockCast = {
      hash: 'test-cast-hash',
      threadId: 'test-thread',
      profile: { fid: 123, username: 'testuser' },
      text: 'Test message',
      timestamp: new Date('2023-01-01'),
      authorFid: 123,
      inReplyTo: null,
    };

    beforeEach(() => {
      mockClient.getCast.mockResolvedValue(mockCast);
      (neynarCastToCast as jest.Mock).mockReturnValue(mockCast);
      (castUuid as jest.Mock).mockImplementation(({ hash, agentId }) => `cast-uuid-${hash}-${agentId}`);
      (createUniqueUuid as jest.Mock).mockImplementation((runtime, id) => `unique-${id}`);
    });

    it('should retrieve a message successfully', async () => {
      const result = await messageService.getMessage('test-message-id', 'test-agent-id');

      expect(mockClient.getCast).toHaveBeenCalledWith('test-message-id');
      expect(result).toMatchObject({
        id: expect.any(String),
        agentId: 'test-agent-id',
        roomId: expect.any(String),
        userId: '123',
        username: 'testuser',
        text: 'Test message',
        type: FarcasterMessageType.CAST,
        timestamp: expect.any(Number),
        inReplyTo: undefined,
      });
    });

    it('should handle message with reply', async () => {
      const mockReplycast = {
        ...mockCast,
        inReplyTo: { hash: 'parent-hash', fid: 456 },
      };
      mockClient.getCast.mockResolvedValue(mockReplycast);
      (neynarCastToCast as jest.Mock).mockReturnValue(mockReplycast);

      const result = await messageService.getMessage('test-message-id', 'test-agent-id');

      expect(result?.type).toBe(FarcasterMessageType.REPLY);
      expect(result?.inReplyTo).toBeDefined();
    });

    it('should return null when cast not found', async () => {
      mockClient.getCast.mockRejectedValue(new Error('Cast not found'));

      const result = await messageService.getMessage('nonexistent-id', 'test-agent-id');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching message:', expect.any(Error));
    });

    it('should handle client error gracefully', async () => {
      mockClient.getCast.mockRejectedValue(new Error('Network error'));

      const result = await messageService.getMessage('test-message-id', 'test-agent-id');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching message:', expect.any(Error));
    });

    it('should include correct metadata in result', async () => {
      const result = await messageService.getMessage('test-message-id', 'test-agent-id');

      expect(result?.metadata).toMatchObject({
        castHash: 'test-cast-hash',
        threadId: 'test-thread',
        authorFid: 123,
      });
    });
  });

  describe('deleteMessage', () => {
    it('should log a warning when attempting to delete a message', async () => {
      await messageService.deleteMessage('test-message-id', 'test-agent-id');

      expect(logger.warn).toHaveBeenCalledWith('[Farcaster] Cast deletion is not supported by the Farcaster API');
    });

    it('should not throw an error when called', async () => {
      await expect(messageService.deleteMessage('test-message-id', 'test-agent-id')).resolves.toBeUndefined();
    });
  });

  describe('markAsRead', () => {
    it('should log a debug message when marking messages as read', async () => {
      await messageService.markAsRead(['message1', 'message2'], 'test-agent-id');

      expect(logger.debug).toHaveBeenCalledWith('[Farcaster] Mark as read is not applicable for Farcaster casts');
    });

    it('should handle empty message array', async () => {
      await expect(messageService.markAsRead([], 'test-agent-id')).resolves.toBeUndefined();
    });

    it('should handle single message', async () => {
      await expect(messageService.markAsRead(['message1'], 'test-agent-id')).resolves.toBeUndefined();
    });
  });

  describe('Edge Cases and Integration Tests', () => {
    it('should handle null/undefined inputs gracefully', async () => {
      // Test getMessages with null options
      const result1 = await messageService.getMessages({});
      expect(result1).toBeInstanceOf(Array);

      // Test getMessage with empty string
      const result2 = await messageService.getMessage('', 'test-agent-id');
      expect(result2).toBeNull();
    });

    it('should handle concurrent operations', async () => {
      mockClient.getTimeline.mockResolvedValue({ timeline: [] });
      mockClient.sendCast.mockResolvedValue([{
        hash: 'concurrent-hash',
        threadId: 'concurrent-thread',
        profile: { fid: 12345, username: 'agent' },
        text: 'Concurrent message',
        timestamp: new Date(),
        authorFid: 12345,
      }]);
      (neynarCastToCast as jest.Mock).mockReturnValue({
        hash: 'concurrent-hash',
        threadId: 'concurrent-thread',
        profile: { fid: 12345, username: 'agent' },
        text: 'Concurrent message',
        timestamp: new Date(),
        authorFid: 12345,
      });

      const promises = [
        messageService.getMessages({}),
        messageService.sendMessage({
          agentId: 'test-agent-id',
          roomId: 'test-room',
          text: 'Test',
          type: FarcasterMessageType.CAST,
        }),
      ];

      const results = await Promise.all(promises);
      expect(results[0]).toBeInstanceOf(Array);
      expect(results[1]).toHaveProperty('id');
    });

    it('should handle very long message text', async () => {
      const longText = 'a'.repeat(1000);
      mockClient.sendCast.mockResolvedValue([{
        hash: 'long-hash',
        threadId: 'long-thread',
        profile: { fid: 12345, username: 'agent' },
        text: longText,
        timestamp: new Date(),
        authorFid: 12345,
      }]);
      (neynarCastToCast as jest.Mock).mockReturnValue({
        hash: 'long-hash',
        threadId: 'long-thread',
        profile: { fid: 12345, username: 'agent' },
        text: longText,
        timestamp: new Date(),
        authorFid: 12345,
      });

      const result = await messageService.sendMessage({
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: longText,
        type: FarcasterMessageType.CAST,
      });

      expect(result.text).toBe(longText);
    });

    it('should handle special characters in message text', async () => {
      const specialText = '🎉 Special chars: @user #hashtag $symbol & <script>alert("xss")</script>';
      mockClient.sendCast.mockResolvedValue([{
        hash: 'special-hash',
        threadId: 'special-thread',
        profile: { fid: 12345, username: 'agent' },
        text: specialText,
        timestamp: new Date(),
        authorFid: 12345,
      }]);
      (neynarCastToCast as jest.Mock).mockReturnValue({
        hash: 'special-hash',
        threadId: 'special-thread',
        profile: { fid: 12345, username: 'agent' },
        text: specialText,
        timestamp: new Date(),
        authorFid: 12345,
      });

      const result = await messageService.sendMessage({
        agentId: 'test-agent-id',
        roomId: 'test-room',
        text: specialText,
        type: FarcasterMessageType.CAST,
      });

      expect(result.text).toBe(specialText);
    });

    it('should handle network timeouts', async () => {
      const timeoutError = new Error('Network timeout');
      timeoutError.name = 'TimeoutError';
      mockClient.getTimeline.mockRejectedValue(timeoutError);

      const result = await messageService.getMessages({});

      expect(result).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith('[Farcaster] Error fetching messages:', timeoutError);
    });
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with valid client and runtime', () => {
      const service = new FarcasterMessageService(mockClient, mockRuntime);
      expect(service).toBeInstanceOf(FarcasterMessageService);
    });

    it('should store client and runtime references', () => {
      const service = new FarcasterMessageService(mockClient, mockRuntime);
      expect((service as any).client).toBe(mockClient);
      expect((service as any).runtime).toBe(mockRuntime);
    });
  });
});

// Test utilities and helpers
const createMockCast = (overrides = {}) => ({
  hash: 'default-hash',
  threadId: 'default-thread',
  profile: { fid: 123, username: 'testuser' },
  text: 'Default message',
  timestamp: new Date('2023-01-01'),
  authorFid: 123,
  inReplyTo: null,
  ...overrides,
});

const createMockMessage = (overrides = {}) => ({
  id: 'default-message-id',
  agentId: 'test-agent-id',
  roomId: 'test-room-id',
  userId: '123',
  username: 'testuser',
  text: 'Default message',
  type: FarcasterMessageType.CAST,
  timestamp: Date.now(),
  inReplyTo: undefined,
  metadata: {},
  ...overrides,
});

// Additional type safety tests
describe('Type Safety and Interface Compliance', () => {
  it('should implement IMessageService interface correctly', () => {
    expect(typeof messageService.getMessages).toBe('function');
    expect(typeof messageService.sendMessage).toBe('function');
    expect(typeof messageService.getMessage).toBe('function');
    expect(typeof messageService.deleteMessage).toBe('function');
    expect(typeof messageService.markAsRead).toBe('function');
  });

  it('should handle UUID type for agentId', async () => {
    const uuidAgentId = '550e8400-e29b-41d4-a716-446655440000';
    const result = await messageService.getMessage('test-id', uuidAgentId);

    // Should not throw type errors
    expect(result).toBeNull();
  });

  it('should handle Message interface compliance', async () => {
    const mockCast = createMockCast();
    mockClient.sendCast.mockResolvedValue([mockCast]);
    (neynarCastToCast as jest.Mock).mockReturnValue(mockCast);

    const result = await messageService.sendMessage({
      agentId: 'test-agent-id',
      roomId: 'test-room',
      text: 'Test message',
      type: FarcasterMessageType.CAST,
    });

    // Verify all Message interface properties are present
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('agentId');
    expect(result).toHaveProperty('roomId');
    expect(result).toHaveProperty('userId');
    expect(result).toHaveProperty('username');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('metadata');
    expect(typeof result.id).toBe('string');
    expect(typeof result.agentId).toBe('string');
    expect(typeof result.roomId).toBe('string');
    expect(typeof result.userId).toBe('string');
    expect(typeof result.username).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(typeof result.type).toBe('string');
    expect(typeof result.timestamp).toBe('number');
  });
});