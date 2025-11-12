import { elizaLogger, UUID } from "@elizaos/core";

const DEFAULT_CLEANUP_THRESHOLD = 48 * 60 * 60 * 1000; // 48 hours
const DEFAULT_REPORTING_INTERVAL = 60 * 60 * 1000; // 1 hour
const DEFAULT_REPORTING_THRESHOLD = 10;

export class SpamFilterManager {
    private blockedUsers: Map<string, { username: string; count: number, lastBlockedTimestamp: number }> = new Map();
    private lastReportedCount: number = 0;
    private lastReportedTimestamp: number = 0;

    constructor() {
        elizaLogger.info("SpamFilterManager initialized.");
    }

    public addUserToBlockList(username: string, senderId: string): void {
        const now = Date.now();
        this.cleanupBlockedUsers();

        const existingUser = this.blockedUsers.get(senderId);

        if (!existingUser) {
            this.blockedUsers.set(senderId, {
                username: username,
                count: 1,
                lastBlockedTimestamp: now,
            });
        } else {
            existingUser.count++;
            existingUser.lastBlockedTimestamp = now;
        }

        this.logBlockedUsersReport();
    }

    public isUserBlocked(senderId: UUID): boolean {
        return this.blockedUsers.has(senderId);
    }

    private cleanupBlockedUsers(): void {
        const now = Date.now();
        
        this.blockedUsers.forEach((user, userId) => {
            if (now - user.lastBlockedTimestamp > DEFAULT_CLEANUP_THRESHOLD) {
                this.blockedUsers.delete(userId);
            }
        });
    }

    private logBlockedUsersReport(): void {
        const now = Date.now();
        const blockedUsersCount = this.blockedUsers.size;

        const shouldLogReport = (blockedUsersCount - this.lastReportedCount >= DEFAULT_REPORTING_THRESHOLD) || (now - this.lastReportedTimestamp > DEFAULT_REPORTING_INTERVAL);
        
        if (shouldLogReport) {
            const filteredReport: { username: string; count: number; }[] = [];
            this.blockedUsers.forEach(user => {
                filteredReport.push({
                    username: user.username,
                    count: user.count
                });
            });

            elizaLogger.warn(`Spam Filter report ${blockedUsersCount}: ${JSON.stringify(filteredReport)}`);
            this.lastReportedCount = blockedUsersCount;
            this.lastReportedTimestamp = now;
        }
    }
}
