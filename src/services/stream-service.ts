import { logger } from '@elizaos/core';
import {
    HubEvent,
    HubEventType,
    Message,
    MessageType,
    getSSLHubRpcClient,
    createDefaultMetadataKeyInterceptor,
    ClientOptions,
    HubRpcClient,
    fromFarcasterTime,
    CastAddBody,
    Protocol,
} from '@farcaster/hub-nodejs';
import { EventEmitter } from 'events';
import GraphemeSplitter from 'grapheme-splitter';
import { FarcasterClient } from '../client';
import { FarcasterConfig, Cast, Profile } from '../common/types';

var latestEventId: number = 0;
// TODO: Move to a common place
const saveLatestEventId = async (id: number) => {
    latestEventId = id;
};

const getLatestEvent = async (): Promise<number | undefined> => {
    return latestEventId;
};

interface FarcasterStreamServiceParams {
    config: FarcasterConfig;
    client: FarcasterClient;
}

export class FarcasterStreamService extends EventEmitter {
    private static instance: FarcasterStreamService;
    private hubClient: HubRpcClient | undefined;
    private isConnected: boolean = false;
    private isReconnecting: boolean = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private currentStream: any = null;
    private isRunning: boolean = false;

    private config: FarcasterConfig;
    private client: FarcasterClient;

    private constructor(params: FarcasterStreamServiceParams) {
        super();
        this.config = params.config;
        this.client = params.client;
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

        const hubRpcUrl = this.config.FARCASTER_HUB_RPC!;
        const hubRpc = hubRpcUrl.replace(/^(https?:\/\/)/, '');

        const hubClientOptions: Partial<ClientOptions> = {
            interceptors: [
                createDefaultMetadataKeyInterceptor('x-api-key', this.config.FARCASTER_NEYNAR_API_KEY),
            ],
        };

        this.hubClient = getSSLHubRpcClient(hubRpc, hubClientOptions);
        const lastId = await getLatestEvent();
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
                    await saveLatestEventId(e.id);
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
                logger.error('Farcaster: Error streaming data. ID: ' + getLatestEvent());
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
            eventId: await getLatestEvent(),
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
            const latestEvent = await getLatestEvent();
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
        const agentFid = this.config.FARCASTER_FID;
        const isMention = msg.data?.castAddBody?.mentions.includes(agentFid);
        const isReply = msg.data?.castAddBody?.parentCastId?.fid === agentFid;

        const targetChannels = (this.config.FARCASTER_TARGET_CHANNELS || '').split(',').filter(Boolean);
        const targetUsers = (this.config.FARCASTER_TARGET_USERS || '').split(',').map(Number).filter(Boolean);
        const targetRegex = this.config.FARCASTER_TARGET_REGEX ? new RegExp(this.config.FARCASTER_TARGET_REGEX) : null;

        const parentUrl = msg.data?.castAddBody?.parentUrl;
        const authorFid = msg.data!.fid;
        const text = msg.data!.castAddBody!.text;

        const shouldProcess =
            isMention ||
            isReply ||
            (parentUrl && targetChannels.some(channel => parentUrl.includes(channel))) ||
            (targetUsers.includes(authorFid) && (!targetRegex || targetRegex.test(text)));

        if (shouldProcess) {
            try {
                const userProfile = await this.client.getProfile(authorFid);
                const cast = await this.createCastObj(msg, userProfile);
                if (cast) {
                    this.emit('cast', cast);
                    console.log(cast)
                }
            } catch (error: any) {
                logger.error(`Error fetching profile for FID ${authorFid}:`, error);
            }
        }
    }

    private async createCastObj(message: Message, userProfile: Profile): Promise<Cast | undefined> {
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
        } : undefined;

        return {
            hash,
            authorFid: message.data.fid,
            text: textWithMentions,
            profile: userProfile,
            inReplyTo,
            timestamp: this.farcasterTimeToDate(message.data.timestamp),
        };
    }

    private bytesToHex(value: Uint8Array): `0x${string}` {
        return `0x${Buffer.from(value).toString("hex")}`;
    }

    private farcasterTimeToDate(time: number): Date;
    private farcasterTimeToDate(time: null): null;
    private farcasterTimeToDate(time: undefined): undefined;
    private farcasterTimeToDate(time: number | null | undefined): Date | null | undefined {
        if (time === undefined) return undefined;
        if (time === null) return null;
        const result = fromFarcasterTime(time);
        if (result.isErr()) throw result.error;
        return new Date(result.value);
    }

    private async handleUserFid(fid: number): Promise<string> {
        try {
            const user = await this.client.getProfile(fid);
            return user.username;
        } catch (error: any) {
            logger.error(`Error fetching profile for FID ${fid} in handleUserFid:`, error);
            return `fid:${fid}`;
        }
    }

    private async insertMentions(text: string, mentions: number[], mentionsPositions: number[]): Promise<string> {
        const splitter = new GraphemeSplitter();
        const graphemes = splitter.splitGraphemes(text);

        for (let i = mentions.length - 1; i >= 0; i--) {
            const mention = mentions[i];
            const fName = await this.handleUserFid(mention);
            const position = mentionsPositions[i];
            graphemes.splice(position, 0, `@${fName}`);
        }
        return graphemes.join('');
    }
}

