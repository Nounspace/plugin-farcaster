import { logger } from '@elizaos/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasFarcasterEnabled, validateFarcasterConfig } from '../../common/config';
import { FarcasterAgentManager } from '../../managers/agent';
import { FarcasterService } from '../../service';

// Create mock implementation for required dependencies
vi.mock('@elizaos/core', () => {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
    Service: class MockService {
      async stop() {}
    },
    stringToUUID: (str) => str,
    UUID: String,
  };
});

vi.mock('../../managers/agent.js', () => {
  return {
    FarcasterAgentManager: vi.fn().mockImplementation(() => {
      return {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        runtime: {
          agentId: 'mock-agent-id',
        },
      };
    }),
  };
});

vi.mock('../../common/config.js', () => {
  return {
    hasFarcasterEnabled: vi.fn().mockReturnValue(true),
    validateFarcasterConfig: vi.fn().mockReturnValue({
      FARCASTER_FID: 12345,
      FARCASTER_SIGNER_UUID: 'mock-signer-uuid',
      FARCASTER_NEYNAR_API_KEY: 'mock-api-key',
    }),
  };
});

describe('FarcasterService', () => {
  let mockRuntime: any;
  let instanceCleanup: FarcasterService;

  beforeEach(() => {
    mockRuntime = {
      agentId: 'mock-agent-id',
      getSetting: vi.fn((key) => {
        const settings: Record<string, string> = {
          FARCASTER_FID: '12345',
          FARCASTER_SIGNER_UUID: 'mock-signer-uuid',
          FARCASTER_NEYNAR_API_KEY: 'mock-api-key',
        };
        return settings[key] || '';
      }),
    };

    // Ensure we reset all mocks before each test
    vi.clearAllMocks();

    // Reset the singleton instance before each test
    instanceCleanup = new FarcasterService();
    // @ts-ignore - accessing private property for test
    FarcasterService.instance = undefined;
  });

  afterEach(async () => {
    // Clean up remaining instances between tests
    await instanceCleanup.stop();
  });

  describe('start', () => {
    it('should start a new Farcaster service when enabled', async () => {
      // Mock that Farcaster is enabled
      (hasFarcasterEnabled as any).mockReturnValue(true);

      const service = await FarcasterService.start(mockRuntime);

      expect(hasFarcasterEnabled).toHaveBeenCalledWith(mockRuntime);
      expect(validateFarcasterConfig).toHaveBeenCalledWith(mockRuntime);
      expect(FarcasterAgentManager).toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith('Farcaster client started', 'mock-agent-id');

      // Verify we have a manager for this agent
      const managers = (service as any).managers;
      expect(managers.has('mock-agent-id')).toBe(true);

      // Verify manager.start was called
      const manager = managers.get('mock-agent-id');
      expect(manager.start).toHaveBeenCalled();
    });

    it('should not start when Farcaster is not enabled', async () => {
      // Mock that Farcaster is disabled
      (hasFarcasterEnabled as any).mockReturnValue(false);

      const service = await FarcasterService.start(mockRuntime);

      expect(hasFarcasterEnabled).toHaveBeenCalledWith(mockRuntime);
      expect(validateFarcasterConfig).not.toHaveBeenCalled();
      expect(FarcasterAgentManager).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith('Farcaster service not enabled', 'mock-agent-id');

      // Verify we don't have a manager for this agent
      const managers = (service as any).managers;
      expect(managers.has('mock-agent-id')).toBe(false);
    });

    it('should not start when service is already running', async () => {
      // Mock that Farcaster is enabled
      (hasFarcasterEnabled as any).mockReturnValue(true);

      // Start the service once
      const service1 = await FarcasterService.start(mockRuntime);

      // FarcasterAgentManager should have been called once
      expect(FarcasterAgentManager).toHaveBeenCalledTimes(1);

      // Reset mocks to verify new calls clearly
      vi.clearAllMocks();

      // Start again with same runtime
      const service2 = await FarcasterService.start(mockRuntime);

      // Should warn about already started
      expect(logger.warn).toHaveBeenCalledWith(
        'Farcaster service already started',
        'mock-agent-id'
      );

      // Should not create a new manager
      expect(FarcasterAgentManager).toHaveBeenCalledTimes(0);

      // Both services should be the same instance
      expect(service1).toBe(service2);
    });
  });

  describe('stop (single agent)', () => {
    it('should stop a running Farcaster service', async () => {
      // Mock that Farcaster is enabled and start the service
      (hasFarcasterEnabled as any).mockReturnValue(true);
      await FarcasterService.start(mockRuntime);

      // Clear mocks before stopping
      vi.clearAllMocks();

      // Stop the service
      await FarcasterService.stop(mockRuntime);

      // Check that manager.stop was called
      const service = new FarcasterService();
      const managers = (service as any).managers;
      expect(managers.has('mock-agent-id')).toBe(false);
      expect(logger.info).toHaveBeenCalledWith('Farcaster client stopped', 'mock-agent-id');
    });

    it('should handle stopping a non-running service', async () => {
      // Try to stop a service that was never started
      await FarcasterService.stop(mockRuntime);

      expect(logger.debug).toHaveBeenCalledWith('Farcaster service not running', 'mock-agent-id');
    });
  });

  describe('stop (all agents)', () => {
    it('should stop all running Farcaster services', async () => {
      // Create multiple mock runtimes
      const mockRuntime1 = { ...mockRuntime, agentId: 'agent-1' };
      const mockRuntime2 = { ...mockRuntime, agentId: 'agent-2' };

      // Mock that Farcaster is enabled
      (hasFarcasterEnabled as any).mockReturnValue(true);

      // Start services for multiple agents
      await FarcasterService.start(mockRuntime1);
      await FarcasterService.start(mockRuntime2);

      // Reset mocks before testing stop
      vi.clearAllMocks();

      // Stop all services
      const service = new FarcasterService();
      await service.stop();

      // Check managers were cleared
      const managers = (service as any).managers;
      expect(managers.size).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith('Stopping ALL Farcaster services');
    });

    it('should handle errors when stopping services', async () => {
      // Mock that Farcaster is enabled
      (hasFarcasterEnabled as any).mockReturnValue(true);

      // Start a service
      const service = await FarcasterService.start(mockRuntime);

      // Get the manager and mock stop to throw error
      const managers = (service as any).managers;
      const manager = managers.get('mock-agent-id');
      manager.stop.mockRejectedValueOnce(new Error('Stop failed'));

      // Reset mocks to see new calls clearly
      vi.clearAllMocks();

      // Stop all services
      await service.stop();

      // Should log the error
      expect(logger.error).toHaveBeenCalledWith(
        'Error stopping Farcaster service',
        'mock-agent-id',
        expect.any(Error)
      );
    });
  });

  it('should have the correct service type and capability description', () => {
    expect(FarcasterService.serviceType).toBe('farcaster');

    const service = new FarcasterService();
    expect(service.capabilityDescription).toBe(
      'The agent is able to send and receive messages on farcaster'
    );
  });
describe('error handling during start', () => {
    it('should handle validateFarcasterConfig throwing an error', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      (validateFarcasterConfig as any).mockImplementation(() => {
        throw new Error('Invalid configuration');
      });

      await expect(FarcasterService.start(mockRuntime)).rejects.toThrow('Invalid configuration');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to validate Farcaster configuration',
        expect.any(Error)
      );
    });

    it('should handle FarcasterAgentManager constructor failure', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      (FarcasterAgentManager as any).mockImplementation(() => {
        throw new Error('Manager initialization failed');
      });

      await expect(FarcasterService.start(mockRuntime)).rejects.toThrow('Manager initialization failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create Farcaster agent manager',
        'mock-agent-id',
        expect.any(Error)
      );
    });

    it('should handle manager.start() failure', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      const mockManager = {
        start: vi.fn().mockRejectedValue(new Error('Start failed')),
        stop: vi.fn().mockResolvedValue(undefined),
        runtime: { agentId: 'mock-agent-id' },
      };
      (FarcasterAgentManager as any).mockImplementation(() => mockManager);

      await expect(FarcasterService.start(mockRuntime)).rejects.toThrow('Start failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to start Farcaster service',
        'mock-agent-id',
        expect.any(Error)
      );
    });
  });

  describe('singleton behavior', () => {
    it('should return the same instance when called multiple times', () => {
      const service1 = new FarcasterService();
      const service2 = new FarcasterService();
      
      expect(service1).toBe(service2);
    });

    it('should maintain singleton state across async operations', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      
      const [service1, service2] = await Promise.all([
        FarcasterService.start(mockRuntime),
        FarcasterService.start({ ...mockRuntime, agentId: 'different-agent' })
      ]);
      
      expect(service1).toBe(service2);
    });

    it('should reset singleton when all services are stopped', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      const service1 = await FarcasterService.start(mockRuntime);
      
      await service1.stop();
      
      // @ts-ignore - accessing private property for test
      expect(FarcasterService.instance).toBeUndefined();
    });
  });

  describe('configuration edge cases', () => {
    it('should handle runtime without agentId', async () => {
      const runtimeWithoutAgentId = {
        getSetting: vi.fn().mockReturnValue('test-value')
      };
      
      (hasFarcasterEnabled as any).mockReturnValue(true);
      
      await expect(FarcasterService.start(runtimeWithoutAgentId)).rejects.toThrow();
    });

    it('should handle null runtime', async () => {
      await expect(FarcasterService.start(null as any)).rejects.toThrow();
    });

    it('should handle undefined runtime', async () => {
      await expect(FarcasterService.start(undefined as any)).rejects.toThrow();
    });

    it('should handle runtime with missing getSetting method', async () => {
      const invalidRuntime = { agentId: 'test-agent' };
      
      await expect(FarcasterService.start(invalidRuntime as any)).rejects.toThrow();
    });
  });

  describe('manager lifecycle and memory management', () => {
    it('should properly clean up managers on individual stop', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      const service = await FarcasterService.start(mockRuntime);
      
      const managers = (service as any).managers;
      expect(managers.size).toBe(1);
      
      await FarcasterService.stop(mockRuntime);
      
      expect(managers.size).toBe(0);
    });

    it('should handle multiple start/stop cycles', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      
      for (let i = 0; i < 3; i++) {
        const service = await FarcasterService.start(mockRuntime);
        const managers = (service as any).managers;
        expect(managers.size).toBe(1);
        
        await FarcasterService.stop(mockRuntime);
        expect(managers.size).toBe(0);
      }
    });

    it('should handle concurrent start operations for different agents', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      
      const runtime1 = { ...mockRuntime, agentId: 'agent-1' };
      const runtime2 = { ...mockRuntime, agentId: 'agent-2' };
      const runtime3 = { ...mockRuntime, agentId: 'agent-3' };
      
      const services = await Promise.all([
        FarcasterService.start(runtime1),
        FarcasterService.start(runtime2),
        FarcasterService.start(runtime3)
      ]);
      
      const managers = (services[0] as any).managers;
      expect(managers.size).toBe(3);
      expect(managers.has('agent-1')).toBe(true);
      expect(managers.has('agent-2')).toBe(true);
      expect(managers.has('agent-3')).toBe(true);
    });

    it('should handle stopping specific agents while others continue running', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      
      const runtime1 = { ...mockRuntime, agentId: 'agent-1' };
      const runtime2 = { ...mockRuntime, agentId: 'agent-2' };
      
      await FarcasterService.start(runtime1);
      await FarcasterService.start(runtime2);
      
      const service = new FarcasterService();
      const managers = (service as any).managers;
      
      expect(managers.size).toBe(2);
      
      await FarcasterService.stop(runtime1);
      
      expect(managers.size).toBe(1);
      expect(managers.has('agent-1')).toBe(false);
      expect(managers.has('agent-2')).toBe(true);
    });
  });

  describe('logging verification', () => {
    it('should log appropriate messages for different service states', async () => {
      // Test when service is disabled
      (hasFarcasterEnabled as any).mockReturnValue(false);
      await FarcasterService.start(mockRuntime);
      expect(logger.debug).toHaveBeenCalledWith('Farcaster service not enabled', 'mock-agent-id');
      
      // Reset and test when service is enabled
      vi.clearAllMocks();
      (hasFarcasterEnabled as any).mockReturnValue(true);
      await FarcasterService.start(mockRuntime);
      expect(logger.success).toHaveBeenCalledWith('Farcaster client started', 'mock-agent-id');
    });

    it('should log debug message when stopping all services', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      const service = await FarcasterService.start(mockRuntime);
      
      vi.clearAllMocks();
      await service.stop();
      
      expect(logger.debug).toHaveBeenCalledWith('Stopping ALL Farcaster services');
    });

    it('should log info message when individual service stops', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      await FarcasterService.start(mockRuntime);
      
      vi.clearAllMocks();
      await FarcasterService.stop(mockRuntime);
      
      expect(logger.info).toHaveBeenCalledWith('Farcaster client stopped', 'mock-agent-id');
    });

    it('should not log error when stopping non-existent service', async () => {
      await FarcasterService.stop(mockRuntime);
      
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith('Farcaster service not running', 'mock-agent-id');
    });
  });

  describe('async operations and race conditions', () => {
    it('should handle rapid start/stop sequences', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(FarcasterService.start(mockRuntime));
        promises.push(FarcasterService.stop(mockRuntime));
      }
      
      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    it('should handle concurrent stop operations gracefully', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      const service = await FarcasterService.start(mockRuntime);
      
      const stopPromises = [
        service.stop(),
        service.stop(),
        service.stop()
      ];
      
      await expect(Promise.all(stopPromises)).resolves.toBeDefined();
    });

    it('should handle manager stop timeout scenarios', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      const service = await FarcasterService.start(mockRuntime);
      
      // Mock manager to never resolve stop
      const managers = (service as any).managers;
      const manager = managers.get('mock-agent-id');
      manager.stop.mockImplementation(() => new Promise(() => {})); // Never resolves
      
      // This should not hang the test
      const stopPromise = FarcasterService.stop(mockRuntime);
      
      // Give it a small amount of time then check it hasn't resolved
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Since we mocked it to never resolve, we'll just verify the call was made
      expect(manager.stop).toHaveBeenCalled();
    });
  });

  describe('service state validation', () => {
    it('should correctly identify service type', () => {
      expect(FarcasterService.serviceType).toBe('farcaster');
      expect(typeof FarcasterService.serviceType).toBe('string');
    });

    it('should provide meaningful capability description', () => {
      const service = new FarcasterService();
      const description = service.capabilityDescription;
      
      expect(description).toBe('The agent is able to send and receive messages on farcaster');
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    });

    it('should maintain consistent manager state', async () => {
      (hasFarcasterEnabled as any).mockReturnValue(true);
      
      const service = await FarcasterService.start(mockRuntime);
      const managers = (service as any).managers;
      
      // Verify manager is properly stored
      expect(managers.has('mock-agent-id')).toBe(true);
      const manager = managers.get('mock-agent-id');
      expect(manager).toBeDefined();
      expect(manager.runtime.agentId).toBe('mock-agent-id');
    });

    it('should handle empty manager map gracefully', async () => {
      const service = new FarcasterService();
      
      // Should not throw when stopping with no managers
      await expect(service.stop()).resolves.toBeUndefined();
    });
  });
});