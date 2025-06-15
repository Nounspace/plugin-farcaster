import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { getConfig, validateConfig, reloadConfig } from '../../../common/config';

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules and environment variables before each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment and clear mocks
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Configuration Loading', () => {
    it('should load default configuration when no environment variables are set', () => {
      const cfg = getConfig();
      expect(cfg).toHaveProperty('port');
      expect(cfg.port).toBe(3000); // replace with actual default
    });

    it('should override defaults with environment variables', () => {
      process.env.PORT = '4000';
      const cfg = getConfig();
      expect(cfg.port).toBe(4000);
    });

    it('should handle missing optional configuration gracefully', () => {
      delete process.env.LOG_LEVEL;
      const cfg = getConfig();
      expect(cfg.logLevel).toBe('info'); // actual default
    });
  });

  describe('Configuration Validation', () => {
    it('should validate required configuration fields', () => {
      delete process.env.DB_HOST;
      expect(() => validateConfig()).toThrow(/DB_HOST.*required/);
    });

    it('should validate configuration value types', () => {
      process.env.MAX_CONNECTIONS = 'not-a-number';
      expect(() => validateConfig()).toThrow(/MAX_CONNECTIONS.*number/);
    });

    it('should validate configuration value ranges and formats', () => {
      process.env.SERVICE_URL = 'invalid-url';
      expect(() => validateConfig()).toThrow(/SERVICE_URL.*valid URL/);
    });
  });

  describe('Environment Handling', () => {
    it('should load development configuration correctly', () => {
      process.env.NODE_ENV = 'development';
      const cfg = getConfig();
      expect(cfg.isDebug).toBe(true);
    });

    it('should load production configuration correctly', () => {
      process.env.NODE_ENV = 'production';
      const cfg = getConfig();
      expect(cfg.isDebug).toBe(false);
    });

    it('should load test configuration correctly', () => {
      process.env.NODE_ENV = 'test';
      const cfg = getConfig();
      expect(cfg.isDebug).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw meaningful errors for invalid configuration', () => {
      process.env.PORT = '-1';
      expect(() => validateConfig()).toThrow(/PORT.*positive integer/);
    });

    it('should handle malformed environment variables gracefully', () => {
      process.env.FEATURE_FLAGS = '{"enableFeature": true';
      expect(() => reloadConfig()).toThrow(/Malformed JSON.*FEATURE_FLAGS/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string environment variables', () => {
      process.env.TIMEOUT = '';
      const cfg = getConfig();
      expect(cfg.timeout).toBeNull();
    });

    it('should handle whitespace-only environment variables', () => {
      process.env.API_KEY = '  ';
      const cfg = getConfig();
      expect(cfg.apiKey).toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should load configuration efficiently', () => {
      const start = process.hrtime.bigint();
      getConfig();
      const duration = process.hrtime.bigint() - start;
      expect(Number(duration)).toBeLessThan(1_000_000); // < 1ms
    });
  });

  describe('Integration', () => {
    it('should integrate properly with logging systems', () => {
      const logSpy = jest.spyOn(console, 'log');
      getConfig();
      expect(logSpy).toHaveBeenCalledWith('Configuration loaded');
      logSpy.mockRestore();
    });
  });

  describe('Specific Config Functions', () => {
    describe('reloadConfig', () => {
      it('should reload configuration when called', () => {
        process.env.NEW_VAR = 'value';
        const before = getConfig();
        process.env.NEW_VAR = 'newValue';
        const after = reloadConfig();
        expect(after.NEW_VAR).toBe('newValue');
        expect(before.NEW_VAR).toBe('value');
      });
    });

    describe('validateConfig', () => {
      it('should return validated config object when valid', () => {
        process.env.DB_HOST = 'localhost';
        const validated = validateConfig();
        expect(validated).toEqual(expect.objectContaining({ DB_HOST: 'localhost' }));
      });
    });
  });
});