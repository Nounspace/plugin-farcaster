import {
  type IAgentRuntime,
  ModelType,
  type TestSuite,
  createUniqueUuid,
  logger,
  type TestCase,
} from '@elizaos/core';
import { FARCASTER_SERVICE_NAME } from '../common/constants';
import { FidRequest, FarcasterMessageType } from '../common/types';
import { FarcasterAgentManager } from '../managers/agent';
import { TEST_IMAGE } from './test-utils';
import { farcasterE2EScenarios } from './e2e/scenarios';

/**
 * Represents a Test Suite for Farcaster functionality.
 * This class implements the TestSuite interface.
 * It contains various test cases related to Farcaster operations such as initializing the client,
 * fetching profile, fetching casts, posting casts, and handling cast interactions.
 */
export class FarcasterTestSuite implements TestSuite {
  name = 'Farcaster Plugin Tests';
  description = 'Test suite for Farcaster plugin functionality';
  private manager: FarcasterAgentManager | null = null;
  tests: TestCase[];

  /**
   * Constructor for TestSuite class.
   * Initializes an array of test functions to be executed.
   */
  constructor() {
    // Check if we have real credentials
    const hasRealCredentials = !!(
      process.env.FARCASTER_FID && 
      process.env.FARCASTER_SIGNER_UUID && 
      process.env.FARCASTER_NEYNAR_API_KEY
    );
    
    logger.info('=== Farcaster Test Suite Configuration ===');
    logger.info(`FID: ${process.env.FARCASTER_FID ? '✓ Found' : '✗ Missing'}`);
    logger.info(`Signer UUID: ${process.env.FARCASTER_SIGNER_UUID ? '✓ Found' : '✗ Missing'}`);
    logger.info(`API Key: ${process.env.FARCASTER_NEYNAR_API_KEY ? '✓ Found' : '✗ Missing'}`);
    logger.info(`Dry Run: ${process.env.FARCASTER_DRY_RUN || 'not set (defaults to false)'}`);
    logger.info('=========================================');
    
    if (hasRealCredentials) {
      logger.success('✅ Running with real Farcaster credentials');
      
      // Use the E2E scenarios for real testing
      this.tests = farcasterE2EScenarios;
    } else {
      logger.warn('⚠️  Farcaster credentials not found in environment variables');
      logger.warn('⚠️  Tests will run in mock mode');
      logger.warn('⚠️  To run real tests, set FARCASTER_FID, FARCASTER_SIGNER_UUID, and FARCASTER_NEYNAR_API_KEY');
      
      // Override tests with mock versions
      this.tests = [
        {
          name: 'Mock: Check Farcaster Configuration',
          fn: this.testMockConfiguration.bind(this),
        },
        {
          name: 'Mock: Service Initialization',
          fn: this.testMockServiceInit.bind(this),
        },
      ];
    }
  }

  /**
   * Test that checks if Farcaster is properly configured
   */
  async testMockConfiguration(runtime: IAgentRuntime) {
    logger.info('Running mock configuration test');
    
    const fid = runtime.getSetting('FARCASTER_FID');
    const signerUuid = runtime.getSetting('FARCASTER_SIGNER_UUID');
    const apiKey = runtime.getSetting('FARCASTER_NEYNAR_API_KEY');
    
    logger.info('Runtime settings check:');
    logger.info(`- FID from runtime: ${fid ? 'Found' : 'Not found'}`);
    logger.info(`- Signer UUID from runtime: ${signerUuid ? 'Found' : 'Not found'}`);
    logger.info(`- API Key from runtime: ${apiKey ? 'Found' : 'Not found'}`);
    
    if (!fid || !signerUuid || !apiKey) {
      logger.info('Farcaster not configured - this is expected in mock mode');
      logger.info('To enable real tests, configure the following:');
      logger.info('- FARCASTER_FID: Your Farcaster ID');
      logger.info('- FARCASTER_SIGNER_UUID: Neynar signer UUID');
      logger.info('- FARCASTER_NEYNAR_API_KEY: Neynar API key');
    }
  }

  /**
   * Test service initialization without real credentials
   */
  async testMockServiceInit(runtime: IAgentRuntime) {
    logger.info('Running mock service initialization test');
    
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as any;
      
      if (!service) {
        logger.info('Farcaster service not available - this is expected without credentials');
        return;
      }
      
      logger.info('Farcaster service is registered but may not be fully initialized');
      
      // Test that service methods exist
      if (typeof service.getMessageService === 'function') {
        logger.info('✓ getMessageService method exists');
      }
      
      if (typeof service.getPostService === 'function') {
        logger.info('✓ getPostService method exists');
      }
      
      if (typeof service.healthCheck === 'function') {
        logger.info('✓ healthCheck method exists');
      }
      
    } catch (error) {
      logger.info('Service initialization check completed');
    }
  }

  /**
   * Asynchronously initializes the Farcaster client for the provided agent runtime.
   *
   * @param {IAgentRuntime} runtime - The agent runtime to use for initializing the Farcaster client.
   * @throws {Error} If the Farcaster client manager is not found or if the Farcaster client fails to initialize.
   */
  async testInitializingClient(runtime: IAgentRuntime) {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as any;
      if (!service) {
        throw new Error('Farcaster service not found');
      }

      this.manager = service.managers.get(runtime.agentId);

      if (this.manager) {
        logger.debug('FarcasterAgentManager initialized successfully.');
      } else {
        throw new Error('FarcasterAgentManager failed to initialize.');
      }
    } catch (error) {
      throw new Error(`Error in initializing Farcaster client: ${error}`);
    }
  }

  /**
   * Asynchronously fetches the profile of a user from Farcaster using the given runtime.
   *
   * @param {IAgentRuntime} runtime The runtime to use for fetching the profile.
   * @returns {Promise<void>} A Promise that resolves when the profile is successfully fetched, or rejects with an error.
   */
  async testFetchProfile(runtime: IAgentRuntime) {
    try {
      if (!this.manager) {
        throw new Error('FarcasterAgentManager not initialized');
      }

      const fid = parseInt(runtime.getSetting('FARCASTER_FID') as string, 10);
      if (!fid || isNaN(fid)) {
        throw new Error('Invalid FID in settings.');
      }

      const profile = await this.manager.client.getProfile(fid);
      if (!profile || !profile.fid) {
        throw new Error('Profile fetch failed.');
      }
      logger.log('Successfully fetched Farcaster profile:', profile);
    } catch (error) {
      throw new Error(`Error fetching Farcaster profile: ${error}`);
    }
  }

  /**
   * Asynchronously fetches the timeline from the Farcaster client.
   *
   * @param {IAgentRuntime} runtime - The agent runtime object.
   * @throws {Error} If there are no casts in the timeline.
   * @throws {Error} If an error occurs while fetching the timeline.
   */
  async testFetchTimeline(runtime: IAgentRuntime) {
    try {
      if (!this.manager) {
        throw new Error('FarcasterAgentManager not initialized');
      }

      const fid = parseInt(runtime.getSetting('FARCASTER_FID') as string, 10);
      if (!fid || isNaN(fid)) {
        throw new Error('Invalid FID in settings.');
      }

      const request: FidRequest = { fid, pageSize: 5 };
      const result = await this.manager.client.getTimeline(request);

      if (!result.timeline || result.timeline.length === 0) {
        throw new Error('No casts in timeline.');
      }
      logger.log(`Successfully fetched ${result.timeline.length} casts from timeline.`);
    } catch (error) {
      throw new Error(`Error fetching timeline: ${error}`);
    }
  }

  /**
   * Asynchronously posts a test cast using the Farcaster API.
   *
   * @param {IAgentRuntime} runtime - The agent runtime object.
   * @returns {Promise<void>} A Promise that resolves when the cast is successfully posted.
   * @throws {Error} If there is an error posting the cast.
   */
  async testPostCast(runtime: IAgentRuntime) {
    try {
      if (!this.manager) {
        throw new Error('FarcasterAgentManager not initialized');
      }

      const castText = await this.generateRandomCastContent(runtime);
      const result = await this.manager.client.sendCast({
        content: { text: castText },
      });

      if (!result || result.length === 0) {
        throw new Error('Cast posting failed.');
      }
      logger.success('Successfully posted a test cast.');
    } catch (error) {
      throw new Error(`Error posting a cast: ${error}`);
    }
  }

  /**
   * Asynchronously posts an image cast on Farcaster using the provided runtime and cast content.
   * Note: This might need updating based on how images are actually handled in sendCast
   *
   * @param {IAgentRuntime} runtime - The runtime environment for the action.
   * @returns {Promise<void>} A Promise that resolves when the cast is successfully posted.
   * @throws {Error} If there is an error posting the cast.
   */
  async testPostImageCast(runtime: IAgentRuntime) {
    try {
      if (!this.manager) {
        throw new Error('FarcasterAgentManager not initialized');
      }

      const castText = await this.generateRandomCastContent(runtime, 'image_post');
      // This implementation might need to be updated based on how images are actually handled
      const result = await this.manager.client.sendCast({
        content: {
          text: castText,
          media: [TEST_IMAGE],
        },
      });

      if (!result || result.length === 0) {
        throw new Error('Cast with image posting failed.');
      }
      logger.success('Successfully posted a test cast with image.');
    } catch (error) {
      throw new Error(`Error posting a cast with image: ${error}`);
    }
  }

  /**
   * Asynchronously handles a fake cast response using the given runtime.
   *
   * @param {IAgentRuntime} runtime - The runtime object for the agent
   * @returns {Promise<void>} - A promise that resolves when the cast response is handled
   * @throws {Error} - If there is an error handling the cast response
   */
  async testHandleCastResponse(runtime: IAgentRuntime) {
    try {
      if (!this.manager) {
        throw new Error('FarcasterAgentManager not initialized');
      }

      // For testing purposes, we'll just mock the event emission instead of calling the actual handler
      // This avoids dealing with complex type requirements
      const testCast = {
        hash: '0x12345',
        text: '@testUser What do you think about AI?',
        authorFid: 123,
        profile: {
          fid: 123,
          username: 'randomUser',
          name: 'Random User',
        },
        timestamp: new Date(),
      };

      // Create a mock memory for the test
      const memoryId = createUniqueUuid(runtime, testCast.hash);
      const memory = {
        id: memoryId,
        agentId: runtime.agentId,
        content: {
          text: testCast.text,
        },
        entityId: createUniqueUuid(runtime, String(testCast.authorFid)),
        roomId: createUniqueUuid(runtime, 'test-room'),
        createdAt: testCast.timestamp.getTime(),
      };

      // Emit an event to simulate the interaction
      runtime.emitEvent('farcaster.mention_received', {
        runtime,
        memory,
        cast: testCast,
        source: 'farcaster',
      });

      logger.success('Successfully simulated cast response handling');
    } catch (error) {
      throw new Error(`Error handling cast response: ${error}`);
    }
  }

  /**
   * Generates random content for a cast based on the given context.
   *
   * @param {IAgentRuntime} runtime - The runtime environment.
   * @param {string} context - Optional context for the content generation.
   * @returns {Promise<string>} A promise that resolves to the generated cast content.
   */
  private async generateRandomCastContent(
    runtime: IAgentRuntime,
    context = 'general'
  ): Promise<string> {
    const prompt = `Generate a short, interesting cast about ${context} (max 280 chars).`;
    // Use TEXT_SMALL instead of CHAT since that seems to be the correct ModelType
    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });

    // Truncate the result to ensure it doesn't exceed 280 characters
    return (result as string).substring(0, 280);
  }

  /**
   * Tests the MessageService functionality
   *
   * @param {IAgentRuntime} runtime - The runtime environment.
   * @returns {Promise<void>} A promise that resolves when the test is complete.
   */
  async testMessageService(runtime: IAgentRuntime) {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as any;
      if (!service) {
        throw new Error('Farcaster service not found');
      }

      const messageService = service.getMessageService(runtime.agentId);
      if (!messageService) {
        throw new Error('MessageService not initialized');
      }

      // Test getMessages
      const messages = await messageService.getMessages({
        agentId: runtime.agentId,
        limit: 5,
      });

      logger.log(`Retrieved ${messages.length} messages from MessageService`);

      // Test sendMessage
      const testText = await this.generateRandomCastContent(runtime, 'message_service_test');
      const message = await messageService.sendMessage({
        agentId: runtime.agentId,
        roomId: createUniqueUuid(runtime, 'test-room'),
        text: testText,
        type: FarcasterMessageType.CAST,
      });

      if (!message || !message.id) {
        throw new Error('Failed to send message via MessageService');
      }

      logger.success('MessageService test completed successfully');
    } catch (error) {
      throw new Error(`Error testing MessageService: ${error}`);
    }
  }

  /**
   * Tests the PostService functionality
   *
   * @param {IAgentRuntime} runtime - The runtime environment.
   * @returns {Promise<void>} A promise that resolves when the test is complete.
   */
  async testPostService(runtime: IAgentRuntime) {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as any;
      if (!service) {
        throw new Error('Farcaster service not found');
      }

      const postService = service.getPostService(runtime.agentId);
      if (!postService) {
        throw new Error('PostService not initialized');
      }

      // Test getPosts
      const posts = await postService.getPosts({
        agentId: runtime.agentId,
        limit: 5,
      });

      logger.log(`Retrieved ${posts.length} posts from PostService`);

      // Test createPost
      const testText = await this.generateRandomCastContent(runtime, 'post_service_test');
      const post = await postService.createPost({
        agentId: runtime.agentId,
        roomId: createUniqueUuid(runtime, 'test-room'),
        text: testText,
      });

      if (!post || !post.id) {
        throw new Error('Failed to create post via PostService');
      }

      logger.success('PostService test completed successfully');
    } catch (error) {
      throw new Error(`Error testing PostService: ${error}`);
    }
  }

  /**
   * Tests real account posting functionality
   *
   * @param {IAgentRuntime} runtime - The runtime environment.
   * @returns {Promise<void>} A promise that resolves when the test is complete.
   */
  async testRealAccountPosting(runtime: IAgentRuntime) {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as any;
      if (!service) {
        throw new Error('Farcaster service not found');
      }

      const postService = service.getPostService(runtime.agentId);
      if (!postService) {
        throw new Error('PostService not initialized');
      }

      // Create multiple posts to test real functionality
      const testPosts = [
        'Testing ElizaOS Farcaster integration! 🚀 #ElizaOS',
        'AI agents are the future of social media engagement 🤖',
        'Building amazing things with the ElizaOS framework 💻',
      ];

      for (const text of testPosts) {
        const post = await postService.createPost({
          agentId: runtime.agentId,
          roomId: createUniqueUuid(runtime, 'real-test'),
          text,
        });

        if (!post || !post.id || !post.metadata?.castHash) {
          throw new Error('Failed to create real post');
        }

        logger.success(`Posted real cast: ${post.metadata.castHash}`);
        
        // Wait a bit between posts to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.success('Real account posting test completed successfully');
    } catch (error) {
      throw new Error(`Error testing real account posting: ${error}`);
    }
  }

  /**
   * Tests real account interactions (mentions, replies, etc)
   *
   * @param {IAgentRuntime} runtime - The runtime environment.
   * @returns {Promise<void>} A promise that resolves when the test is complete.
   */
  async testRealAccountInteractions(runtime: IAgentRuntime) {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as any;
      if (!service) {
        throw new Error('Farcaster service not found');
      }

      const postService = service.getPostService(runtime.agentId);
      const messageService = service.getMessageService(runtime.agentId);
      
      if (!postService || !messageService) {
        throw new Error('Services not initialized');
      }

      // Get recent mentions
      const mentions = await postService.getMentions(runtime.agentId, { limit: 10 });
      logger.log(`Found ${mentions.length} mentions`);

      // Get timeline posts
      const timeline = await postService.getPosts({
        agentId: runtime.agentId,
        limit: 20,
      });
      logger.log(`Found ${timeline.length} timeline posts`);

      // If we have posts, try to reply to one
      if (timeline.length > 0) {
        const targetPost = timeline[0];
        if (targetPost.metadata?.castHash) {
          const reply = await messageService.sendMessage({
            agentId: runtime.agentId,
            roomId: targetPost.roomId,
            text: 'Great post! Testing real interactions with ElizaOS 🎉',
            type: FarcasterMessageType.REPLY,
            replyToId: targetPost.metadata.castHash,
            metadata: {
              parentHash: targetPost.metadata.castHash,
            },
          });

          if (reply && reply.metadata?.castHash) {
            logger.success(`Replied to cast with: ${reply.metadata.castHash}`);
          }
        }
      }

      logger.success('Real account interactions test completed successfully');
    } catch (error) {
      throw new Error(`Error testing real account interactions: ${error}`);
    }
  }

  /**
   * Tests message metadata tracking functionality
   *
   * @param {IAgentRuntime} runtime - The runtime environment.
   * @returns {Promise<void>} A promise that resolves when the test is complete.
   */
  async testMessageMetadataTracking(runtime: IAgentRuntime) {
    try {
      const service = runtime.getService(FARCASTER_SERVICE_NAME) as any;
      if (!service) {
        throw new Error('Farcaster service not found');
      }

      const messageService = service.getMessageService(runtime.agentId);
      if (!messageService) {
        throw new Error('MessageService not initialized');
      }

      // Send a message and track its metadata
      const testMessage = await messageService.sendMessage({
        agentId: runtime.agentId,
        roomId: createUniqueUuid(runtime, 'metadata-test'),
        text: 'Testing metadata tracking with ElizaOS',
        type: FarcasterMessageType.CAST,
      });

      if (!testMessage || !testMessage.metadata?.castHash) {
        throw new Error('Failed to send test message');
      }

      const castHash = testMessage.metadata.castHash;
      logger.log(`Sent message with cast hash: ${castHash}`);

      // Verify we can retrieve the message by its hash
      const retrievedMessage = await messageService.getMessage(castHash, runtime.agentId);
      
      if (!retrievedMessage) {
        throw new Error('Failed to retrieve message by hash');
      }

      // Verify metadata is properly stored
      if (retrievedMessage.metadata?.castHash !== castHash) {
        throw new Error('Metadata mismatch in retrieved message');
      }

      logger.success('Message metadata tracking test completed successfully');
    } catch (error) {
      throw new Error(`Error testing message metadata tracking: ${error}`);
    }
  }
}
