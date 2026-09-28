import { describe, expect, it } from 'vitest';
import { calculateLogicalCount, generateImpositionPlan, getPageMapping } from './impositionLogic';
import { PDFMetadata } from '../types';

const metadata = (originalPageCount: number, sourceType: 'spread' | 'single'): PDFMetadata => ({
  originalPageCount,
  paddedPageCount: Math.ceil(originalPageCount / 4) * 4,
  width: 420,
  height: 297,
  targetWidthMm: 420,
  targetHeightMm: 297,
  unit: 'pts',
  sourceType,
});

describe('imposition logic', () => {
  it('calculates logical pages for a cover, two spreads and a back cover', () => {
    expect(calculateLogicalCount(4, 'spread')).toBe(6);
    expect(calculateLogicalCount(5, 'single')).toBe(5);
  });

  it('maps the two halves of a spread independently', () => {
    const meta = metadata(6, 'spread');
    expect(getPageMapping(2, meta, 4)).toMatchObject({ physicalIdx: 2, isRightHalf: false, isSingle: false });
    expect(getPageMapping(3, meta, 4)).toMatchObject({ physicalIdx: 2, isRightHalf: true, isSingle: false });
    expect(getPageMapping(6, meta, 4)).toMatchObject({ physicalIdx: 4, isSingle: true });
  });

  it('pads six pages and produces the correct two-sheet order', () => {
    expect(generateImpositionPlan(metadata(6, 'spread'))).toEqual([
      expect.objectContaining({ type: 'front', leftPage: 8, rightPage: 1, isBlankLeft: true }),
      expect.objectContaining({ type: 'back', leftPage: 2, rightPage: 7, isBlankRight: true }),
      expect.objectContaining({ type: 'front', leftPage: 6, rightPage: 3 }),
      expect.objectContaining({ type: 'back', leftPage: 4, rightPage: 5 }),
    ]);
  });
});
