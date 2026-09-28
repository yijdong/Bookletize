
import { PDFMetadata, SpreadInfo } from '../types';

/**
 * 计算总内容页数
 * 双页模式：封面(1) + (中间物理页 * 2) + 封底(1)
 * 单页模式：原始物理页数
 */
export const calculateLogicalCount = (physicalCount: number, sourceType: 'spread' | 'single'): number => {
  if (sourceType === 'single') return physicalCount;
  if (physicalCount <= 2) return physicalCount;
  return 2 + (physicalCount - 2) * 2;
};

/**
 * 核心映射逻辑：根据内容页码找到对应的 PDF 物理页及裁切信息
 */
export const getPageMapping = (
  logicalPageNum: number,
  meta: PDFMetadata,
  totalPhysicalPages: number
) => {
  // 处理空白补位页
  if (logicalPageNum > meta.originalPageCount) {
    return { isBlank: true, physicalIdx: -1, isRightHalf: false, isSingle: true };
  }

  // 单页模式：一对一直接映射
  if (meta.sourceType === 'single') {
    return { isBlank: false, physicalIdx: logicalPageNum, isRightHalf: false, isSingle: true };
  }

  // 双页连画模式：
  if (logicalPageNum === 1) {
    // 封面固定为 PDF 的第一页
    return { isBlank: false, physicalIdx: 1, isRightHalf: false, isSingle: true };
  } else if (logicalPageNum === meta.originalPageCount) {
    // 封底固定为 PDF 的最后一页
    return { isBlank: false, physicalIdx: totalPhysicalPages, isRightHalf: false, isSingle: true };
  } else {
    // 内页映射：内容页2 -> 物理页2左半，内容页3 -> 物理页2右半
    const physIdx = Math.floor((logicalPageNum - 2) / 2) + 2;
    const isRight = logicalPageNum % 2 === 1;
    return { isBlank: false, physicalIdx: physIdx, isRightHalf: isRight, isSingle: false };
  }
};

/**
 * 生成骑马钉排序计划（4页内容排在1张打印纸的正反面）
 */
export const generateImpositionPlan = (meta: PDFMetadata): SpreadInfo[] => {
  const N = meta.paddedPageCount;
  const sheetCount = N / 4;
  const plan: SpreadInfo[] = [];

  for (let i = 1; i <= sheetCount; i++) {
    // 打印纸正面：最外页在左，最内页在右
    const fL = N - 2 * (i - 1);
    const fR = 2 * i - 1;
    plan.push({
      index: (i - 1) * 2,
      type: 'front',
      leftPage: fL,
      rightPage: fR,
      isBlankLeft: fL > meta.originalPageCount,
      isBlankRight: fR > meta.originalPageCount
    });

    // 打印纸反面：次内页在左，次外页在右
    const bL = 2 * i;
    const bR = N - 2 * i + 1;
    plan.push({
      index: (i - 1) * 2 + 1,
      type: 'back',
      leftPage: bL,
      rightPage: bR,
      isBlankLeft: bL > meta.originalPageCount,
      isBlankRight: bR > meta.originalPageCount
    });
  }
  return plan;
};
