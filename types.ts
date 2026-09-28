
export interface TargetDimensions {
  width: number;  // 毫米
  height: number; // 毫米
}

export interface PDFMetadata {
  originalPageCount: number; // 逻辑总页数
  paddedPageCount: number;   // 补齐后的总页数（4的倍数）
  width: number;             // 单页逻辑宽度 (pts)
  height: number;            // 单页逻辑高度 (pts)
  targetWidthMm: number;     // 目标整张纸宽度 (mm)
  targetHeightMm: number;    // 目标整张纸高度 (mm)
  unit: string;
  sourceType: 'spread' | 'single'; // 来源类型：跨页或单页
}

export interface SpreadInfo {
  index: number;
  type: 'front' | 'back';
  leftPage: number; // 1-indexed 逻辑页码
  rightPage: number; // 1-indexed 逻辑页码
  isBlankLeft: boolean;
  isBlankRight: boolean;
}

export interface ProcessingState {
  status: 'idle' | 'loading' | 'imposing' | 'ready' | 'error';
  progress: number;
  error?: string;
}
