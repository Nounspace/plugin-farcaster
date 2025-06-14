import { FarcasterService } from './service.js';
import { FarcasterTestSuite } from './__tests__/suite.js';
import { farcasterActions } from './actions/index.js';
import { farcasterProviders } from './providers/index.js';

const farcasterPlugin = {
  name: 'farcaster',
  description: 'Farcaster client plugin for sending and receiving casts',
  services: [FarcasterService],
  actions: farcasterActions,
  providers: farcasterProviders,
  tests: [new FarcasterTestSuite()],
};

export default farcasterPlugin;
