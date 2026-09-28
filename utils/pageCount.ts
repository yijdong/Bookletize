export const getMissingPageCount = (pageCount: number): number => {
  if (pageCount <= 0) return 4;
  return (4 - (pageCount % 4)) % 4;
};

export const isValidSaddleStitchPageCount = (pageCount: number): boolean =>
  pageCount > 0 && getMissingPageCount(pageCount) === 0;
