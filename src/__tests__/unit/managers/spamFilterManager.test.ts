import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SpamFilterManager } from '../../../managers/spamFilterManager';
import { createTestUUID } from '../../helpers/mock-utils';

describe('SpamFilterManager', () => {
    let spamFilterManager: SpamFilterManager;

    beforeEach(() => {
        spamFilterManager = new SpamFilterManager();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should add a user to the blocklist', () => {
        const userId = createTestUUID('user1');
        spamFilterManager.addUserToBlockList('user1', userId);
        expect(spamFilterManager.isUserBlocked(userId)).toBe(true);
    });

    it('should not block a user who is not on the blocklist', () => {
        const userId = createTestUUID('user2');
        expect(spamFilterManager.isUserBlocked(userId)).toBe(false);
    });

    it('should increment the block count for a user', () => {
        const userId = createTestUUID('user3');
        spamFilterManager.addUserToBlockList('user3', userId);
        spamFilterManager.addUserToBlockList('user3', userId);
        // @ts-ignore - accessing private property for test
        expect(spamFilterManager.blockedUsers.get(userId)?.count).toBe(2);
    });

    it('should cleanup expired users from the blocklist', () => {
        const userId = createTestUUID('user4');
        const initialTime = new Date().getTime();
        vi.spyOn(Date, 'now').mockReturnValue(initialTime);

        spamFilterManager.addUserToBlockList('user4', userId);

        // Advance time by more than 48 hours
        vi.spyOn(Date, 'now').mockReturnValue(initialTime + 48 * 60 * 60 * 1000 + 1);

        // @ts-ignore - accessing private property for test
        spamFilterManager.cleanupBlockedUsers();

        expect(spamFilterManager.isUserBlocked(userId)).toBe(false);
    });

    it('should not cleanup users who are not expired', () => {
        const userId = createTestUUID('user5');
        const initialTime = new Date().getTime();
        vi.spyOn(Date, 'now').mockReturnValue(initialTime);

        spamFilterManager.addUserToBlockList('user5', userId);

        // Advance time by less than 48 hours
        vi.spyOn(Date, 'now').mockReturnValue(initialTime + 24 * 60 * 60 * 1000);

        // @ts-ignore - accessing private property for test
        spamFilterManager.cleanupBlockedUsers();

        expect(spamFilterManager.isUserBlocked(userId)).toBe(true);
    });
});
