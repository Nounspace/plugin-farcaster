import {
  type IAgentRuntime,
  composePrompt,
  Content,
  logger,
  ModelType,
} from '@elizaos/core';
import { Conversation, Cast as NeynarCast } from '@neynar/nodejs-sdk/build/api';
import type { FarcasterClient } from '../client';
import { defaultTargetUserPrompt } from '../common/prompts/targetUserPrompt';
import {
  type Cast,
  type FarcasterConfig,
} from '../common/types';

type CustomTargetsArray = FarcasterConfig['FARCASTER_CUSTOM_TARGETS']; 
type CustomTargetConfig = NonNullable<CustomTargetsArray>[number];

function extractConversationDetails(data: Conversation): { historyConversation: string, imageUrls: string } {
    const conversation = data.conversation.cast;
    const chronological_parent_casts = data.conversation.chronological_parent_casts;

    // Extract conversation details
    const conversationText = conversation.text.split('\n').slice(0, -3).join('\n');;
    const conversationUsername = conversation.author.username;
    const conversationParentFid = conversation.parent_author?.fid;

    // Filter and map matching chronological parent casts
    let parentCasts: string[] = []
    if (chronological_parent_casts) {
        parentCasts = chronological_parent_casts
            .filter(cast => cast.author && cast.author?.fid === conversationParentFid)
            .map(cast => `@${cast.author.username}: ${cast.text}`);
    }

    // IMAGE PROCESSING REMOVED FROM NOW... KEEP FOR REFERENCE
    // let imageUrls: string[] = [];
    // try {
    //     const allImageUrls = chronological_parent_casts
    //         .filter(cast => cast.author?.fid === conversationParentFid)
    //         .flatMap(cast =>
    //             (cast.embeds || []).filter(embed =>
    //                 embed.metadata?.content_type?.includes("image")
    //             )
    //         )
    //         .map(embed => embed.url);

    //     imageUrls = await this.filterImageUrls(allImageUrls);
    // } catch (error) {
    //     elizaLogger.error("Farcaster: Error extracting image URLs");
    //     elizaLogger.error(error);
    // }

    // elizaLogger.log(imageUrls);

    // Add the conversation details
    const conversationDetail = `@${conversationUsername}: ${conversationText}`;

    // Combine parent casts and the conversation detail
    const formattedDetails = [...parentCasts, conversationDetail];

    // Join the formatted details with a newline character
    // return formattedDetails.join('\n');

    return {
        historyConversation: formattedDetails.join('\n'),
        imageUrls: ""
    }
}

export async function handleCustomTargetUserCast(
    cast: Cast, 
    targetConfig: CustomTargetConfig, 
    runtime: IAgentRuntime, 
    client: FarcasterClient, 
    config: FarcasterConfig
): Promise<void> {
  // 1. Check trigger conditions
  const trigger = targetConfig.trigger;

  // Check username first (if specified)
  if (trigger.username && cast.username !== trigger.username) {
      logger.debug(`Cast from @${cast.username} does not match trigger username @${trigger.username}`);
      return;
  }

  // Check for content match in text or embeds
  let contentTriggerMet = false;
  const hasTextTrigger = !!trigger.textContains;
  const hasEmbedsTrigger = !!trigger.embedsContains;

  // If no content triggers are defined, a username match is enough.
  if (!hasTextTrigger && !hasEmbedsTrigger) {
      contentTriggerMet = true;
  } else {
      // Check text
      if (hasTextTrigger && cast.text.includes(trigger.textContains!)) {
          contentTriggerMet = true;
      }
      // If not found in text, check embeds
      if (!contentTriggerMet && hasEmbedsTrigger && cast.embeds) {
          if (cast.embeds.some(url => url.includes(trigger.embedsContains!))) {
              contentTriggerMet = true;
          }
      }
  }

  if (!contentTriggerMet) {
      logger.debug(`Cast from @${cast.username} did not meet content trigger conditions.`);
      return;
  }

  logger.info(`Handling custom target user cast from @${cast.username} based on config.`);

  // 2. Perform extractions
  const extractedData: { [key: string]: string } = {};
  for (const extraction of targetConfig.extractions) {
      if (extractedData[extraction.name]) continue; // Already found this data point

      try {
          const regex = new RegExp(extraction.regex);
          const source = extraction.source || 'text'; // Default to text

          if (source === 'text') {
              const match = cast.text.match(regex);
              if (match && match[0]) {
                  extractedData[extraction.name] = match[0];
              }
          } else if (source === 'embeds' && cast.embeds) {
              for (const embedUrl of cast.embeds) {
                  const match = embedUrl.match(regex);
                  if (match && match[0]) {
                      extractedData[extraction.name] = match[0];
                      break; // Found it in one of the embeds, move to next extraction rule
                  }
              }
          }
      } catch (error) {
          logger.error("Farcaster", `Error executing regex for extraction '${extraction.name}':`, error);
      }
  }

  // 3. Identify original user
  const originalUserFid = cast.inReplyTo?.fid;
  if (!originalUserFid) {
      logger.warn('Custom target cast is not a reply, cannot find original user.');
      return;
  }

  // 4. Fetch original user info and check score
  const originalUserInfo = await client.getProfile(originalUserFid);
  if (!originalUserInfo) {
      logger.warn(`Could not fetch profile for original user FID ${originalUserFid}`);
      return;
  }

  const score = originalUserInfo.score ?? 0;
  if (score < config.MIN_NEYNAR_SCORE) {
      logger.info(`Original user @${originalUserInfo.username} has low score (${score}), ignoring.`);
      return;
  }

  // Fetch conversation history
  let historyConversation = "";
  let imageUrls = "";
  try {
      const castConversation = await client.neynar.lookupCastConversation({
          identifier: cast.hash,
          type: 'hash',
          replyDepth: 2,
          includeChronologicalParentCasts: true,
          viewerFid: config.FARCASTER_FID,
          limit: 10
      });
      
      if (castConversation) {
        const extracted = extractConversationDetails(castConversation);
        historyConversation = extracted.historyConversation;
        imageUrls = extracted.imageUrls;
      }
  } catch (error) {
      logger.error("Farcaster", "Error fetching conversation", error);
  }

  logger.warn("DEBUG", "---:", historyConversation)
  logger.warn("DEBUG", "history conversation:", historyConversation)
  logger.warn("DEBUG", "---:", historyConversation)

  // 5. Build prompt
  const promptTemplate = runtime.character.templates?.[targetConfig.promptTemplateKey] || defaultTargetUserPrompt;
  
  const state = {
      ...extractedData,
      originalUsername: originalUserInfo.username,
      originalUserBio: originalUserInfo.bio || 'No bio provided.',
      historyConversation,
      imageUrls,
  };

  const prompt = composePrompt({ state, template: promptTemplate });

  // 6. Generate reply
  let replyText: string | undefined;
  try {
    const model = ModelType.LARGE;
    const provider = targetConfig.custom_provider;
    const response = await runtime.useModel(model, { prompt }, provider);
    if (typeof response === 'string') {
        replyText = response;
    }
  } catch (error) {
      logger.error("Farcaster",'LLM call failed for custom target reply.', error);
  }

  if (!replyText) {
      logger.warn('LLM generated an empty reply for custom target.');
      return;
  }

  // Append configurable suffix
  if (targetConfig.replySuffix) {
      const suffix = composePrompt({ state, template: targetConfig.replySuffix });
      replyText += suffix;
  }

  // 7. Publish reply
  let finalReplyToHash = cast.hash;
  let finalReplyToFid = cast.authorFid;
  if (targetConfig.replyTo === 'parent' && cast.inReplyTo) {
      finalReplyToHash = cast.inReplyTo.hash;
      finalReplyToFid = cast.inReplyTo.fid;
  }

  logger.info(`Replying to ${targetConfig.replyTo} of cast ${cast.hash} with: ${replyText}`);

  if (config.FARCASTER_DRY_RUN) {
      logger.warn(`[DRY RUN] Would have replied with: ${replyText}`);
      return;
  }

  const attachments: Content['attachments'] = [];
  if (targetConfig.attachmentUrlTemplate) {
      const attachmentUrl = composePrompt({ state, template: targetConfig.attachmentUrlTemplate });
      
      if (attachmentUrl && attachmentUrl.startsWith('http')) {
          attachments.push({
              id: '1',
              url: attachmentUrl,
          });
      }
  }

  await client.sendCast({
      content: { 
          text: replyText,
          attachments: attachments,
      },
      inReplyTo: { hash: finalReplyToHash, fid: finalReplyToFid },
  });
}
