import GraphemeSplitter from 'grapheme-splitter';
import { describe, it, expect } from 'vitest';

function getUsernameFromFid(fid: number): string {
  const usernames: Record<number, string> = {
    259427: 'telurjepe',
    598480: 'xdc',
    289686: 'seiiyuu',
    248447: 'mikhi',
    328067: 'ankermerci',
    357897: 'bizarrebeasts',
    1454055: 'farbangers',
    20364: '0xppl',
    1091550: 'warplet',
    1119323: 'apcollective',
    1115399: 'tierog',
    362850: 'baseboi',
    338896: 'karna',
    852267: 'jpeg',
    302051: '0xtv',
    509008: 'basedly',
  };
  return usernames[fid] ?? `user${fid}`;
}

 function insertMentions(
    text: string,
    mentions: number[],
    mentionPositions: number[]
    ): string {
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
            const fName = getUsernameFromFid(fid);

            // Find nearest grapheme index for this byte position
            let insertIndex = graphemeByteOffsets.findIndex(off => off >= pos);
            if (insertIndex === -1) insertIndex = graphemes.length;

            graphemes.splice(insertIndex, 0, `@${fName}`);
        }

        return graphemes.join('');
    }

 

// --- tests ---
describe('insertMentions – real Farcaster examples', () => {
  it('Warplet Blind Box multiple mentions', async () => {
    const text = `Opening Warplet Blind Boxes is addictive! 🔥 Collect Farcaster profile NFTs on Base. 🟦

Hey     , try opening a Warplet Blind Box too!`;
    const mentions = [259427, 598480, 289686, 248447, 328067];
    const positions = [97, 98, 99, 100, 101];
    const result = await insertMentions(text, mentions, positions);
    expect(result).toMatch(/Hey @telurjepe @xdc @seiiyuu @mikhi @ankermerci, try opening/);
  });

  it('BizarreBeasts single mention ritual #1', async () => {
    const text = `Daily BIZARRE Ritual #1: Create a BizarreBeasts meme! 👹🎨

Create BB art and memes with the Sticker & Meme Creator!

Join me in completing daily $BIZARRE rituals in the BizarreBeasts ($BB) Community! 👹


#BizarreBeasts #BBRituals #BBRitualMeme`;
    const mentions = [357897];
    const positions = [211];
    const result = await insertMentions(text, mentions, positions);
    expect(result).toContain('@bizarrebeasts');
  });

  it('BizarreBeasts single mention ritual #2', async () => {
    const text = `Daily BIZARRE Ritual #2: Fire Up Dexscreener! 🔥

Support $BB on Dexscreener by hitting "🚀" and "🔥"!

Join me in completing daily $BIZARRE rituals in the BizarreBeasts ($BB) Community! 👹


#BizarreBeasts #BBRituals #BBRitualDex`;
    const mentions = [357897];
    const positions = [199];
    const result = await insertMentions(text, mentions, positions);
    expect(result).toContain('@bizarrebeasts');
  });

  it('Purple Banger end-of-text mention', async () => {
    const text = `Just minted my Purple Banger NFT! 🎉

Only certified purple bangers, standing on Farcaster.`;
    const mentions = [1454055];
    const positions = [94];
    const result = await insertMentions(text, mentions, positions);
    expect(result.endsWith('@farbangers')).toBe(true);
  });

  it('Mention at very start (OG Tier refresh)', async () => {
    const text = ` refresh my OG Tier`;
    const mentions = [1115399];
    const positions = [0];
    const result = await insertMentions(text, mentions, positions);
    expect(result.startsWith('@tierog')).toBe(true);
  });

  it('Emoji-heavy Warplet variation (Base mentions)', async () => {
    const text = `Opening Warplet Blind Boxes is addictive! 🔥 Collect Farcaster profile NFTs on Base. 🟦

Hey     , try opening a Warplet Blind Box too!`;
    const mentions = [362850, 338896, 852267, 302051, 509008];
    const positions = [97, 98, 99, 100, 101];
    const result = await insertMentions(text, mentions, positions);
    expect(result).toMatch(/Hey @baseboi @karna @jpeg @0xtv @basedly, try opening/);
  });

  it('Link-only mention', async () => {
    const text = `https://0xppl.com/post/88324/`;
    const mentions = [20364];
    const positions = [1];
    const result = await insertMentions(text, mentions, positions);
    expect(result).toContain('@0xppl');
  });

  it('Mid-text creative collab mention', async () => {
    const text = `love the rubber hose vibe –  nailed that retro energy. great way to spark community creativity imo. plug in with AP Collective for more collabs`;
    const mentions = [1119323];
    const positions = [30];
    const result = await insertMentions(text, mentions, positions);
    expect(result).toContain('@apcollective');
  });

  it('Warplet featured NFT mid-text', async () => {
    const text = `🎁 Check out this Free Warplet NFT! ⭐

Warplet #1091550 featuring 

Collect your own Warplets on Warplet Blind Box! 🎲`;
    const mentions = [1091550];
    const positions = [70];
    const result = await insertMentions(text, mentions, positions);
    expect(result).toContain('@warplet');
  });
});