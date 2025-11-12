import { logger } from '@elizaos/core';
import { FarcasterInteractionSource } from './interaction-source';
import { FarcasterStreamService } from '../services/stream-service';
import { Cast } from '../common/types';

export class FarcasterStreamSource extends FarcasterInteractionSource {
    private streamService: FarcasterStreamService;
    private castHandler = (cast: Cast) => {
        this.processor.processStreamedCast(cast);
    };

    async start(): Promise<void> {
        logger.info('Starting Farcaster stream mode');
        if (this.isRunning) {
            return;
        }
        this.isRunning = true;

        this.streamService = FarcasterStreamService.getInstance({
            config: this.config,
            client: this.client,
        });
        this.streamService.start();
        this.streamService.on('cast', this.castHandler);
    }

    async stop(): Promise<void> {
        logger.info('Stopping Farcaster stream mode');
        if (this.isRunning && this.streamService) {
            this.streamService.removeListener('cast', this.castHandler);
        }
        this.isRunning = false;
    }
}

