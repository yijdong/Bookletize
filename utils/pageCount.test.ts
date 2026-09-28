import { describe, expect, it } from 'vitest';
import { getMissingPageCount, isValidSaddleStitchPageCount } from './pageCount';

describe('saddle-stitch page requirements', () => {
  it.each([[0, 4], [1, 3], [3, 1], [4, 0], [5, 3], [8, 0]])('reports missing pages for %i pages', (count, missing) => {
    expect(getMissingPageCount(count)).toBe(missing);
  });

  it('only accepts a positive multiple of four', () => {
    expect(isValidSaddleStitchPageCount(0)).toBe(false);
    expect(isValidSaddleStitchPageCount(4)).toBe(true);
    expect(isValidSaddleStitchPageCount(6)).toBe(false);
  });
});
