import GraphemeSplitter from 'grapheme-splitter';
import { describe, it, expect } from 'vitest';

async function insertMentions(
  text: string,
  mentions: number[],
  mentionPositions: number[]
): Promise<string> {
  const splitter = new GraphemeSplitter();
  const graphemes = splitter.splitGraphemes(text);

  // --- Build map from UTF-8 byte offset → grapheme index ---
  const encoder = new TextEncoder();
  let byteOffset = 0;
  const offsetMap: number[] = [];
  for (let i = 0; i < graphemes.length; i++) {
    const bytes = encoder.encode(graphemes[i]);
    for (let j = 0; j < bytes.length; j++) offsetMap.push(i);
    byteOffset += bytes.length;
  }

  const getUsernameFromFid = async (fid: number): Promise<string> => {
    const usernames: Record<number, string> = {
      1: 'telurjepe',
      2: 'xdc',
      3: 'seiiyuu',
      4: 'mikhi',
      5: 'ankermerci',
      6: 'neynar',
      7: 'eumil199913.base.eth',
      8: 'based-karma.eth',
      9: 'farbangers',
    };
    return usernames[fid] ?? `user${fid}`;
  };

  // --- Sort descending to preserve offsets ---
  const pairs = mentions
    .map((fid, i) => ({ fid, pos: mentionPositions[i] }))
    .sort((a, b) => b.pos - a.pos);

  for (const { fid, pos } of pairs) {
    const username = await getUsernameFromFid(fid);

    // Map byte offset → grapheme index
    let insertIndex = offsetMap[pos] ?? graphemes.length;

    // Adjust to nearest grapheme boundary (safety for out-of-range)
    insertIndex = Math.max(0, Math.min(insertIndex, graphemes.length));

    const prev = graphemes[insertIndex - 1] ?? '';
    const next = graphemes[insertIndex] ?? '';

    const needsSpaceBefore = prev && !/\s|[@,]/.test(prev);
    const needsSpaceAfter = next && !/\s|[,.!?]/.test(next);

    const mentionText =
      `${needsSpaceBefore ? ' ' : ''}@${username}${needsSpaceAfter ? ' ' : ''}`;

    graphemes.splice(insertIndex, 0, mentionText);
  }

  // Normalize double spaces safely
  return graphemes.join('').replace(/\s{2,}/g, ' ').trim();
}


describe('insertMentions', () => {
  it('should correctly insert multiple mentions in Warplet Blind Box example', async () => {
    const text = 'I just opened a Warplet Blind Box! Collect unique Farcaster profile NFTs at Warplet Blind Box Miniapp on Base 🟦 Hey       , try opening a Warplet Blind Box too!';
    const mentions = [1, 2, 3, 4, 5];
    const positions = [108, 109, 110, 111, 112];

    const result = await insertMentions(text, mentions, positions);

    expect(result).toContain('@telurjepe');
    expect(result).toContain('@ankermerci');
    expect(result).toMatch(/Hey @telurjepe @xdc @seiiyuu @mikhi @ankermerci, try opening/);
  });

  it('should handle single mentions with .eth correctly', async () => {
    const text = 'Your Avatar grows with every action. Earn Karma Points, unlock DEGEN rewards, and secure your spot in the  airdrop.';
    const mentions = [8];
    const positions = [103];

    const result = await insertMentions(text, mentions, positions);
    expect(result).toContain('@based-karma.eth');
  });

  it('should handle emoji safely before mentions', async () => {
    const text = 'Warplet Blind Box opened! 🌟 Collect unique Farcaster community NFTs on Base. 🟦 Hey      , try opening a Warplet Blind Box too!';
    const mentions = [1, 2, 3, 4, 5];
    const positions = [84, 85, 86, 87, 88];

    const result = await insertMentions(text, mentions, positions);
    expect(result).toMatch(/Hey @telurjepe @xdc @seiiyuu @mikhi @ankermerci,/);
  });

  it('should handle end-of-text mentions', async () => {
    const text = 'Just minted my Purple Banger NFT! 🎉 Only certified purple bangers, standing on Farcaster. ';
    const mentions = [9];
    const positions = [86];

    const result = await insertMentions(text, mentions, positions);
    expect(result.endsWith('@farbangers')).toBe(true);
  });

  it('should handle mid-sentence mentions', async () => {
    const text = 'Tagal na din ako dito nagshitcast haha  what is the neynar score of ';
    const mentions = [6, 7];
    const positions = [39, 72];

    const result = await insertMentions(text, mentions, positions);
    expect(result).toMatch(/@neynar/);
    expect(result).toMatch(/@eumil199913\.base\.eth/);
  });
});
