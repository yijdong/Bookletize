export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbedBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export const calculateScaleToFit = (
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
) => {
  if (![srcW, srcH, targetW, targetH].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('页面尺寸必须是大于 0 的有效数字');
  }

  const scale = Math.min(targetW / srcW, targetH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  return {
    scale,
    drawW,
    drawH,
    offsetX: (targetW - drawW) / 2,
    offsetY: (targetH - drawH) / 2,
  };
};

export const getEmbedBounds = (box: PageBox, half: 'full' | 'left' | 'right'): EmbedBounds => {
  const halfWidth = box.width / 2;
  const left = half === 'right' ? box.x + halfWidth : box.x;
  const right = half === 'left' ? box.x + halfWidth : box.x + box.width;

  return {
    left,
    bottom: box.y,
    right,
    top: box.y + box.height,
  };
};
