import { describe, expect, it } from 'vitest';
import { calculateScaleToFit, getEmbedBounds } from './pdfGeometry';

describe('PDF geometry', () => {
  it('creates non-overlapping left and right embed regions', () => {
    const box = { x: 10, y: 20, width: 600, height: 400 };
    const left = getEmbedBounds(box, 'left');
    const right = getEmbedBounds(box, 'right');

    expect(left).toEqual({ left: 10, bottom: 20, right: 310, top: 420 });
    expect(right).toEqual({ left: 310, bottom: 20, right: 610, top: 420 });
    expect(left.right).toBe(right.left);
  });

  it('keeps content proportional and centred', () => {
    expect(calculateScaleToFit(300, 400, 600, 600)).toEqual({
      scale: 1.5,
      drawW: 450,
      drawH: 600,
      offsetX: 75,
      offsetY: 0,
    });
  });

  it('rejects invalid dimensions', () => {
    expect(() => calculateScaleToFit(300, 400, 0, 600)).toThrow();
  });
});
