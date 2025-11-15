import { IAgentRuntime, logger, MemoryType } from '@elizaos/core';
// import type { MemoryScope } from "@elizaos/core";
import {
    HubEvent,
    HubEventType,
    Message,
    MessageType,
    getSSLHubRpcClient,
    createDefaultMetadataKeyInterceptor,
    ClientOptions,
    HubRpcClient,
    UserDataType,
    isUserDataAddMessage,
} from '@farcaster/hub-nodejs';
import { EventEmitter } from 'events';
import GraphemeSplitter from 'grapheme-splitter';
import { FarcasterClient } from '../client';
import {farcasterTimeToDate} from '../common/utils'
import { FarcasterConfig, Cast, Profile, CastType, FarcasterEventTypes } from '../common/types';

interface FarcasterStreamServiceParams {
    config: FarcasterConfig;
    client: FarcasterClient;
    runtime: IAgentRuntime;
}

export class FarcasterStreamService extends EventEmitter {
    private static instance: FarcasterStreamService;
    private hubClient: HubRpcClient;
    private isConnected: boolean = false;
    private isReconnecting: boolean = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private currentStream: any = null;
    private isRunning: boolean = false;    
    private lastDebugLogTime: number = 0;
    private StreamlatestEventBlock: number | null = null;
    
    private config: FarcasterConfig;
    private client: FarcasterClient;
    private runtime: IAgentRuntime;

    private USERS_FNAME_MAP: Map<number, any>;

    private constructor(params: FarcasterStreamServiceParams) {
        super();
        this.config = params.config;
        this.client = params.client;
        this.runtime = params.runtime;
        this.USERS_FNAME_MAP = new Map();

        const hubRpcUrl = this.config.FARCASTER_HUB_RPC!;
        const hubRpc = hubRpcUrl.replace(/^(https?:\/\/)/, '');
        const hubClientOptions: Partial<ClientOptions> = {
            interceptors: [
                createDefaultMetadataKeyInterceptor('x-api-key', this.config.FARCASTER_NEYNAR_API_KEY),
            ],
        };
        this.hubClient = getSSLHubRpcClient(hubRpc, hubClientOptions);
    }

    public static getInstance(params: FarcasterStreamServiceParams): FarcasterStreamService {
        if (!FarcasterStreamService.instance) {
            FarcasterStreamService.instance = new FarcasterStreamService(params);
        }
        return FarcasterStreamService.instance;
    }

    public async start(): Promise<void> {
        if (this.isRunning) {
            return;
        }
        logger.info('Starting Farcaster Stream Service');
        this.isRunning = true;

        const lastId = await this.getStreamLatestEventBlock();
        // logger.warn("DEBUG", "getStreamLatestEventBlock", lastId)
        this.subscriberStream(lastId);
    }

    public async stop(): Promise<void> {
        logger.info('Stopping Farcaster Stream Service');
        this.isRunning = false;
        this.cleanupStream();
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        this.hubClient?.close();
    }

    private async subscriberStream(fromEventId: number | undefined) {
        if (!this.hubClient) {
            logger.error('Farcaster: Hub client not initialized.');
            this.reconnect();
            return;
        }

        const result = await this.hubClient.subscribe({
            eventTypes: [HubEventType.MERGE_MESSAGE],
            fromId: fromEventId,
        });

        if (result.isErr()) {
            logger.error(`Farcaster: Error starting stream: ${result.error.message}`);
            if (this.isRunning) this.reconnect();
            return;
        }

        this.isConnected = true;
        this.isReconnecting = false;

        result.match(
            (stream) => {
                logger.info(`Farcaster: Subscribed Stream from: ${fromEventId ? `event ${fromEventId}` : 'HEAD'}`);
                this.currentStream = stream;

                stream.on('data', async (e: HubEvent) => {
                    if (!this.isRunning) {
                        this.isConnected = false;
                        stream.destroy();
                        return;
                    }
                    await this.saveStreamLatestEventBlock(e.id);
                    // console.log(e.id)
                    this.handleEvent(e);
                });

                stream.on('end', async () => {
                    logger.error(`Farcaster: Hub Stream ended`);
                    this.isConnected = false;
                    if (this.isRunning) {
                        this.reconnect();
                    }
                });

                stream.on('close', async () => {
                    const closeReason = this.determineCloseReason(stream);
                    logger.error(`Farcaster: Hub Stream closed: ${closeReason}`);
                    this.isConnected = false;
                    if (this.isRunning) {
                        this.cleanupStream();
                        this.reconnect();
                    }
                });

                stream.on('error', (error) => {
                    this.handleStreamError(error);
                });
            },
            (e) => {
                logger.error('Farcaster: Error streaming data. ID: ' + this.getStreamLatestEventBlock());
            }
        );
    }

    private determineCloseReason(stream: any): string {
        if (!this.isRunning) {
            return 'Manual stop requested';
        }
        if (stream.destroyed) {
            return 'Stream was destroyed';
        }
        if (stream.error) {
            return `Error occurred: ${stream.error.message}`;
        }
        if (!this.isConnected) {
            return 'Connection lost';
        }
        return 'Unknown reason';
    }

    private async handleStreamError(error: Error): Promise<void> {
        logger.error({
            eventId: await this.getStreamLatestEventBlock(),
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: (error as any).code,
            details: (error as any).details,
            metadata: (error as any).metadata,
        },
        'Farcaster: Stream error details:', );
    }

    private reconnect() {
        if (this.isReconnecting || !this.isRunning) return;

        this.isReconnecting = true;
        this.cleanupStream();

        logger.info('Attempting to reconnect to Farcaster Hub in 3 seconds...');
        this.reconnectTimeout = setTimeout(async () => {
            this.isReconnecting = false;
            const latestEvent = await this.getStreamLatestEventBlock();
            this.subscriberStream(latestEvent);
        }, 3000);
    }

    private cleanupStream() {
        if (this.currentStream) {
            this.currentStream.removeAllListeners();
            this.currentStream.destroy?.();
            this.currentStream = null;
        }
        this.isConnected = false;
    }

    private async handleEvent(event: HubEvent) {
        if (event.type === HubEventType.MERGE_MESSAGE) {
            const msg = event.mergeMessageBody!.message!;
            const msgType = msg.data!.type

            switch (msgType) {
                case MessageType.CAST_ADD: {
                    this.handleAddCast(msg);
                    break
                }
                case MessageType.CAST_REMOVE: {
                    // logger.debug(`Farcaster: Handling CAST_REMOVE (unimplemented): ${this.bytesToHex(msg.hash)}`);
                    break
                }
                case MessageType.REACTION_ADD: {
                    // logger.debug(`Farcaster: Handling REACTION_ADD (unimplemented): ${this.bytesToHex(msg.hash)}`);
                    break
                }
                default: {
                    // logger.info(`Farcaster: UNHANDLED MERGE_MESSAGE EVENT type: ${msgType}, ID: ${event.id}`);
                }
            }
        }
    }

    private async handleAddCast(msg: Message) {
        if (!msg.data) return;

        const castAddBody = msg.data?.castAddBody;
        if (!castAddBody) return;

        

        const agentFid = this.config.FARCASTER_FID;
        const authorFid = msg.data!.fid;

        const isMention = castAddBody.mentions.includes(agentFid);
        const isReply = castAddBody.parentCastId?.fid === agentFid;

        const targetChannels = this.config.FARCASTER_TARGET_CHANNELS || [];
        let isFromTargetChannel = false;

        if (castAddBody.parentUrl) {
            const match = castAddBody.parentUrl.match(/\/~\/channel\/([a-zA-Z0-9_-]+)$/);
            if (match && match[1]) {
                const extractedChannelName = match[1];
                isFromTargetChannel = targetChannels.includes(extractedChannelName);
            }
        }

        const targetUsers = this.config.FARCASTER_TARGET_USERS || [];
        const customTargetFids = (this.config.FARCASTER_CUSTOM_TARGETS || []).map(t => t.fid);
        const allTargetFids = Array.from(new Set([...targetUsers, ...customTargetFids]));
        const isFromTargetUser = allTargetFids.includes(authorFid);

        let castType: CastType = 'other';
        if (isMention) {
            castType = 'mention';
            logger.warn("Farcaster:", "Mention", castAddBody.mentions)
            logger.warn("Farcaster:", "Timestamp", msg.data.timestamp)
        } else if (isReply) {
            castType = 'reply';
            logger.warn("Farcaster:", "Reply", castAddBody.parentCastId?.fid)
            logger.warn("Farcaster:", "Timestamp", msg.data.timestamp)
        } else if (isFromTargetChannel) {
            castType = 'channel';
            logger.warn("Farcaster:", "from Channel", castAddBody.parentUrl)
            logger.warn("Farcaster:", "Timestamp", msg.data.timestamp)
        } else if (isFromTargetUser) {
            castType = 'user';
            logger.warn("Farcaster:", "From Targe tUser", targetUsers)
            logger.warn("Farcaster:", "Timestamp", msg.data.timestamp)
        }

        if (castType == 'other') {
            // const now = Date.now();
            // if (now - this.lastDebugLogTime > 60000) { // 60000 ms = 1 minute
            //     this.lastDebugLogTime = now;
            //     logger.debug("\nStream", "Debug (throttled)", msg.data.castAddBody?.text);
            //     logger.debug('targetUsers: ', `For agent fid: ${agentFid}`, targetUsers);
            //     logger.debug(`Mentions: `, "", castAddBody.mentions);
            //     logger.debug(`Channel: `, "", castAddBody.parentUrl);
            //     logger.debug("\n", "----\n");
            // }
            return
        }
        
        try {
            const cast = await this.createCastObj(msg, castType);
            if (cast) {
                this.emit(FarcasterEventTypes.STREAM_CAST_RECEIVED, cast);
            }
        } catch (error: any) {
            logger.error(`Error processing cast in handleAddCast for FID ${authorFid}:`, error);
        }
    }

    private async createCastObj(message: Message, type: CastType): Promise<Cast | undefined> {
        if (!message.data || !message.data.castAddBody) return;

        const { castAddBody } = message.data;
        const hash = this.bytesToHex(message.hash);

        let textWithMentions = castAddBody.text;
        if (castAddBody.mentions.length > 0) {
            textWithMentions = await this.insertMentions(castAddBody.text, castAddBody.mentions, castAddBody.mentionsPositions);
        }

        const inReplyTo = castAddBody.parentCastId ? {
            hash: this.bytesToHex(castAddBody.parentCastId.hash),
            fid: castAddBody.parentCastId.fid,
            username: await this.getUsernameFromFid(castAddBody.parentCastId.fid),
        } : undefined;

        const embeds = castAddBody.embeds.map(embed => embed.url).filter((url): url is string => !!url);

        const cast = {
            hash,
            authorFid: message.data.fid,
            username: await this.getUsernameFromFid(message.data.fid),
            text: textWithMentions,
            inReplyTo,
            timestamp: farcasterTimeToDate(message.data.timestamp),
            type,
            embeds,
        };

        return cast;
    }

    private bytesToHex(value: Uint8Array): `0x${string}` {
        return `0x${Buffer.from(value).toString("hex")}`;
    }

    private async getUsernameFromFid(fid: number): Promise<string> {
        // Check cache first
        const cached = this.USERS_FNAME_MAP.get(fid);
        if (cached) return cached;

        try {
            // Fetch from hubClient (returns HubResult<Message>)
            const result = await this.hubClient.getUserData({
                fid,
                userDataType: UserDataType.USERNAME
            });

            let username: string | null = null;

            if (result.isOk()) {
                const message = result.value;
                if (isUserDataAddMessage(message)) {
                    username = message.data.userDataBody.value;
                }
            }

            if (!username) {
                // fallback: try getting full profile
                try {
                    const user = await this.client.getProfile(fid);
                    username = user?.username ?? `fid:${fid}`;
                } catch (error: any) {
                    logger.error(`Error fetching profile for FID ${fid}:`, (error.message || error));
                    username = `fid:${fid}`;
                }
            }

            // Cache result
            this.USERS_FNAME_MAP.set(fid, username);

            // Trim cache if too big
            if (this.USERS_FNAME_MAP.size >= 100) {
                const firstKey = this.USERS_FNAME_MAP.keys().next().value as number;
                this.USERS_FNAME_MAP.delete(firstKey);
            }

            return username;
        } catch (error: any) {
            logger.error(`Error resolving FID ${fid}:`, (error.message || error));
            return `fid:${fid}`;
        }
    }

    private async insertMentions(
    text: string,
    mentions: number[],
    mentionPositions: number[]
    ): Promise<string> {
        const splitter = new GraphemeSplitter();
        const graphemes = splitter.splitGraphemes(text);

        // Build byte offset map for each grapheme
        const encoder = new TextEncoder();
        let byteOffset = 0;
        const graphemeByteOffsets = graphemes.map(g => {
            const start = byteOffset;
            byteOffset += encoder.encode(g).length;
            return start;
        });

        // Sort descending to avoid index shifting
        const pairs = mentions.map((fid, i) => ({
            fid,
            pos: mentionPositions[i],
        })).sort((a, b) => b.pos - a.pos);

        for (const { fid, pos } of pairs) {
            const fName = await this.getUsernameFromFid(fid);

            // Find nearest grapheme index for this byte position
            let insertIndex = graphemeByteOffsets.findIndex(off => off >= pos);
            if (insertIndex === -1) insertIndex = graphemes.length;

            graphemes.splice(insertIndex, 0, `@${fName}`);
        }

        return graphemes.join('');
    }

    private saveStreamLatestEventBlock = async (blockId: number) => {
        this.StreamlatestEventBlock = blockId;

        // const memory = {
        //     agentId: this.runtime.agentId,
        //     entityId: this.runtime.agentId,
        //     roomId: this.runtime.agentId,
        //     content: {
        //         text: `Farcaster Latest Processed Block: ${blockId}`,
        //         metadata: { blockId },
        //         source: 'stream-service',
        //     },
        //     metadata: {
        //         type: MemoryType.CUSTOM,
        //         scope: 'shared' as MemoryScope,
        //         source: 'stream-service',
        //         timestamp: Date.now(),
        //         tags: ['stream', 'latestBlock'],
        //     },
        //     createdAt: Date.now(),
        //     unique: true,
        // };

        // await this.runtime.createMemory(memory, 'memories');
        // elizaLogger.warn(`✅ Saved Farcaster stream latest block ${blockId}`);
    };

    private getStreamLatestEventBlock = async (): Promise<number> => {
        if (this.StreamlatestEventBlock !== null) {
            logger.warn(`✅ Loaded Farcaster stream latest block from this.StreamlatestEventBlock`);
            return this.StreamlatestEventBlock;
        }

        // const results = await this.runtime.searchMemories({
        //     embedding: [],
        //     tableName: 'memories',
        //     query: `WHERE metadata->>'source' = 'stream-service' 
        //             AND 'stream' = ANY(metadata->'tags') 
        //             ORDER BY created_at DESC 
        //             LIMIT 1`,
        //     });

        // elizaLogger.warn(JSON.stringify(results), "Stream Search Query results:");

        // if (results.length > 0) {
        //     const metadata = results[0].content.metadata as { blockId?: number };
        //     elizaLogger.warn(`${metadata.blockId}`,"metadata.blockId}" );
        //     return metadata.blockId ?? 0;
        // }

        return 0;
    };

}

