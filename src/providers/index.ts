export { farcasterProfileProvider } from './profileProvider';
export { farcasterTimelineProvider } from './timelineProvider';

import { farcasterProfileProvider } from './profileProvider';
import { farcasterTimelineProvider } from './timelineProvider';

// Export all providers as an array for easy plugin registration
export const farcasterProviders = [farcasterProfileProvider, farcasterTimelineProvider];
