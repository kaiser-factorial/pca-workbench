import { describe, it, expect } from 'vitest';
import { searchMethods, METHODS_TOPICS, METHODS } from '../methods';

describe('methods reference retrieval', () => {
  it('covers at least the 14 launch topics', () => {
    expect(METHODS_TOPICS.length).toBeGreaterThanOrEqual(14);
  });

  it('returns exact topic matches', () => {
    expect(searchMethods({ topics: ['silhouette'] })[0]?.title).toBe('Silhouette scores');
  });

  it('finds the component-retention chunk from a natural question', () => {
    const hits = searchMethods({ query: 'how many components should I keep' });
    expect(hits.some(c => c.title === 'How many components to keep')).toBe(true);
  });

  it('routes cluster-meaningfulness questions to validity/silhouette content', () => {
    const hits = searchMethods({ query: 'is my clustering meaningful or artificial' });
    expect(hits.some(c => /silhouette|seriously/i.test(c.title))).toBe(true);
  });

  it('finds effect-size content', () => {
    const hits = searchMethods({ query: 'eta squared effect size benchmarks' });
    expect(hits.some(c => /Eta-squared/.test(c.title))).toBe(true);
  });

  it('caps keyword results (topics can add more)', () => {
    expect(searchMethods({ query: 'pca components cluster variance data' }).length).toBeLessThanOrEqual(4);
  });

  it('returns nothing for gibberish', () => {
    expect(searchMethods({ query: 'zzqx' })).toHaveLength(0);
  });

  it('every chunk names a source (a year, or the course notebook)', () => {
    for (const [key, chunk] of Object.entries(METHODS)) {
      expect(/\b(1[89]\d\d|20[0-2]\d)\b|NYU CDS/.test(chunk.text), `chunk "${key}" lacks a citation`).toBe(true);
    }
  });
});
