import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PDFDocument, PDFEmbeddedPage } from 'pdf-lib';
// Must be the `legacy` build — see the note in PDFCropEditor.tsx. The modern build calls
// native `Map.prototype.getOrInsertComputed` / `Uint8Array.prototype.toHex`, which older
// mobile engines lack; the legacy build polyfills them.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import { PDFMetadata, ProcessingState, TargetDimensions } from '../types';
import * as Logic from '../utils/impositionLogic';
import { calculateScaleToFit, getEmbedBounds } from '../utils/pdfGeometry';
import { requestSaveHandle, saveBlobToHandleOrDownload, saveBlobWithPicker } from '../utils/saveFile';
import { toUserMessage } from '../utils/userMessage';
import { BouncingDots } from './ui/BouncingDots';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const MM_TO_PTS = 72 / 25.4;
const MAX_LOGICAL_PAGES = 240;
const MAX_PREVIEW_EDGE = 960;

interface ImpositionEngineProps {
  file: File;
  targetDims: TargetDimensions;
  exportsEnabled?: boolean;
  onPageSelect?: (pageNumber: number) => void;
  missingPages?: number;
  onFillMissingPages?: () => void;
  logicalPagePreviews?: Array<{ url: string; pageNum: number }>;
  logicalPageCount?: number;
  leadingAction?: React.ReactNode;
  controlsMount?: HTMLElement | null;
  /** True when the mobile export controls sit in the collapsed drawer bar, where there is no room for the loading label. */
  controlsCompact?: boolean;
}

interface PreviewImage { url: string; blob: Blob; pageNum?: number }

export const ImpositionEngine: React.FC<ImpositionEngineProps> = ({ file, targetDims, exportsEnabled = true, onPageSelect, missingPages = 0, onFillMissingPages, logicalPagePreviews, logicalPageCount, leadingAction, controlsMount, controlsCompact = false }) => {
  const [state, setState] = useState<ProcessingState>({ status: 'loading', progress: 0 });
  const [metadata, setMetadata] = useState<PDFMetadata | null>(null);
  const [logicalPreviews, setLogicalPreviews] = useState<PreviewImage[]>([]);
  const [sheetPreviews, setSheetPreviews] = useState<PreviewImage[]>([]);
  const [imposedPdfBlob, setImposedPdfBlob] = useState<Blob | null>(null);
  const [viewMode, setViewMode] = useState<'reading' | 'imposition'>('reading');
  const [isExportingImages, setIsExportingImages] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [currentUnitIndex, setCurrentUnitIndex] = useState(0);
  const [turnDirection, setTurnDirection] = useState<'next' | 'previous'>('next');
  const [turnKey, setTurnKey] = useState(0);
  const processingVersion = useRef(0);
  const generatedUrlsRef = useRef(new Set<string>());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const revokeGeneratedUrls = () => {
    generatedUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    generatedUrlsRef.current.clear();
  };

  useEffect(() => () => revokeGeneratedUrls(), []);

  const canvasToPreview = (canvas: HTMLCanvasElement) => new Promise<PreviewImage>((resolve, reject) => {
    canvas.toBlob(blob => {
      // Zero the canvas right after encoding so WebKit releases the backing store
      // immediately. iOS Safari does not reclaim canvas memory on GC alone, and
      // repeated edits otherwise accumulate until the WebContent process is killed.
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) return reject(new Error('无法生成页面预览'));
      const url = URL.createObjectURL(blob);
      generatedUrlsRef.current.add(url);
      resolve({ url, blob });
    }, 'image/png');
  });

  const runProcessor = useCallback(async () => {
    const version = ++processingVersion.current;
    revokeGeneratedUrls();
    setLogicalPreviews(logicalPagePreviews?.map(page => ({ ...page, blob: new Blob() })) ?? []);
    setSheetPreviews([]);
    setSheetsLoading(true);
    setImposedPdfBlob(null);
    setCurrentUnitIndex(0);
    setState({ status: 'loading', progress: 0 });
    try {
      const arrayBuffer = await file.arrayBuffer();
      const previewPdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
      const logicalCount = previewPdf.numPages;
      if (logicalCount > MAX_LOGICAL_PAGES) throw new Error(`文档共有 ${logicalCount} 页，当前最多支持 ${MAX_LOGICAL_PAGES} 页。`);
      const meta: PDFMetadata = {
        originalPageCount: logicalCount,
        paddedPageCount: Math.ceil(logicalCount / 4) * 4,
        width: (targetDims.width / 2) * MM_TO_PTS,
        height: targetDims.height * MM_TO_PTS,
        targetWidthMm: targetDims.width,
        targetHeightMm: targetDims.height,
        unit: 'pts',
        sourceType: 'single',
      };
      setMetadata(meta);
      const logical: PreviewImage[] = logicalPagePreviews?.map(page => ({ ...page, blob: new Blob() })) ?? [];
      if (!logicalPagePreviews) {
        for (let pageNumber = 1; pageNumber <= previewPdf.numPages; pageNumber++) {
          if (version !== processingVersion.current) return;
          const page = await previewPdf.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(1.35, MAX_PREVIEW_EDGE / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
          logical.push({ ...(await canvasToPreview(canvas)), pageNum: pageNumber });
          setState({ status: 'loading', progress: Math.round((pageNumber / previewPdf.numPages) * 42) });
        }
      }
      await previewPdf.destroy();
      if (version !== processingVersion.current) return;
      setLogicalPreviews(logical);
      setState({ status: 'imposing', progress: 45 });

      const sourcePdf = await PDFDocument.load(arrayBuffer.slice(0));
      const outputPdf = await PDFDocument.create();
      const plan = Logic.generateImpositionPlan(meta);
      const embeddedCache = new Map<number, PDFEmbeddedPage>();
      for (let index = 0; index < plan.length; index++) {
        const spread = plan[index];
        const outputPage = outputPdf.addPage([meta.width * 2, meta.height]);
        const draw = async (logicalPage: number, x: number, blank: boolean) => {
          if (blank || logicalPage > sourcePdf.getPageCount()) return;
          const sourcePage = sourcePdf.getPage(logicalPage - 1);
          let embedded = embeddedCache.get(logicalPage);
          if (!embedded) {
            embedded = await outputPdf.embedPage(sourcePage, getEmbedBounds(sourcePage.getCropBox(), 'full'));
            embeddedCache.set(logicalPage, embedded);
          }
          const box = sourcePage.getCropBox();
          const fit = calculateScaleToFit(box.width, box.height, meta.width, meta.height);
          outputPage.drawPage(embedded, { x: x + fit.offsetX, y: fit.offsetY, width: fit.drawW, height: fit.drawH });
        };
        await draw(spread.leftPage, 0, spread.isBlankLeft);
        await draw(spread.rightPage, meta.width, spread.isBlankRight);
        setState({ status: 'imposing', progress: 45 + Math.round(((index + 1) / plan.length) * 35) });
      }
      const bytes = await outputPdf.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      setImposedPdfBlob(blob);
      setState({ status: 'ready', progress: 100 });
      const sheetPdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      const sheets: PreviewImage[] = [];
      for (let pageNumber = 1; pageNumber <= sheetPdf.numPages; pageNumber++) {
        const page = await sheetPdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.15, MAX_PREVIEW_EDGE / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        sheets.push(await canvasToPreview(canvas));
      }
      await sheetPdf.destroy();
      if (version !== processingVersion.current) return;
      setSheetPreviews(sheets);
      setSheetsLoading(false);
    } catch (reason) {
      if (version !== processingVersion.current) return;
      console.error(reason);
      setState({ status: 'error', progress: 0, error: toUserMessage(reason, '无法处理这个 PDF。请换一个文件重试。') });
    }
  }, [file, targetDims, logicalPagePreviews]);

  useEffect(() => { void runProcessor(); }, [runProcessor]);

  const readingUnits = useMemo(() => {
    if (!logicalPreviews.length) return [];
    const units: PreviewImage[][] = [[logicalPreviews[0]]];
    for (let index = 1; index < logicalPreviews.length - 1; index += 2) units.push(logicalPreviews.slice(index, index + 2));
    if (logicalPreviews.length > 1) units.push([logicalPreviews[logicalPreviews.length - 1]]);
    return units;
  }, [logicalPreviews]);

  const changeUnit = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(readingUnits.length - 1, nextIndex));
    if (clamped === currentUnitIndex) return;
    setTurnDirection(clamped > currentUnitIndex ? 'next' : 'previous');
    setCurrentUnitIndex(clamped);
    setTurnKey(value => value + 1);
    const page = readingUnits[clamped]?.[0]?.pageNum;
    if (page) onPageSelect?.(page);
  };

  const pageRangeLabel = useMemo(() => {
    const unit = readingUnits[currentUnitIndex] ?? [];
    if (!unit.length) return '';
    const first = unit[0].pageNum!;
    const last = unit[unit.length - 1].pageNum!;
    return `第 ${first === last ? first : `${first}–${last}`} 页 / 共 ${logicalPageCount ?? metadata?.originalPageCount ?? logicalPreviews.length} 页`;
  }, [currentUnitIndex, logicalPageCount, logicalPreviews.length, metadata, readingUnits]);

  const outputMatchesCurrentPages = state.status === 'ready' && (logicalPageCount === undefined || metadata?.originalPageCount === logicalPageCount);
  const downloadsPreparing = exportsEnabled && (state.status === 'loading' || state.status === 'imposing' || !outputMatchesCurrentPages || sheetsLoading);
  const currentPageCount = logicalPageCount ?? metadata?.originalPageCount ?? 0;
  const removablePageCount = currentPageCount >= 5 ? currentPageCount % 4 : 0;

  const exportControls = (mobile: boolean) => (
    <div className={mobile ? 'flex w-full flex-wrap items-center justify-end gap-2 min-[1367px]:hidden' : 'absolute right-0 top-[-74px] z-40 hidden h-12 items-center gap-3 min-[1367px]:flex'}>
      {leadingAction && <div className={mobile ? 'w-full min-[768px]:mr-auto min-[768px]:w-auto' : 'mr-auto shrink-0'}>{leadingAction}</div>}
      <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 min-[768px]:gap-3">
        {downloadsPreparing && (
          <div aria-live="polite" className="flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap text-xs font-medium text-ink-secondary min-[768px]:mr-1 min-[768px]:justify-start">
            <BouncingDots className="h-[7px] w-7 text-[#686C4E]" />
            {controlsCompact ? null : '正在准备文件…'}
          </div>
        )}
        <div className="grid w-auto shrink-0 grid-cols-2 gap-2 min-[768px]:gap-3">
          <ExportButton label={isExportingImages ? '正在打包…' : '导出图包'} disabled={!exportsEnabled || !outputMatchesCurrentPages || sheetsLoading || isExportingImages} onClick={() => void downloadZip()} tip={exportsEnabled ? '将每张打印纸的正面和背面导出为高清 PNG 图片，并自动打包下载。适合逐张导入打印软件或保存备份。' : '页数还不符合骑马钉要求，补齐后才能导出。'} />
          <ExportButton label="下载PDF" disabled={!exportsEnabled || !outputMatchesCurrentPages} onClick={() => void downloadPdf()} primary tip={exportsEnabled ? '下载已经按骑马钉页序排好的双面打印 PDF。请保持实际尺寸打印，并根据打印预览确认双面翻转方向。' : '页数还不符合骑马钉要求，补齐后才能下载。'} />
        </div>
      </div>
    </div>
  );

  const downloadPdf = async () => {
    if (!imposedPdfBlob || !exportsEnabled) return;
    await saveBlobWithPicker(imposedPdfBlob, `打印稿_${targetDims.width}x${targetDims.height}mm_${file.name}`, [{ description: 'PDF 文件', accept: { 'application/pdf': ['.pdf'] } }]);
  };

  const downloadZip = async () => {
    if (!exportsEnabled || isExportingImages || !sheetPreviews.length) return;
    const fileName = `排版图包_${targetDims.width}x${targetDims.height}mm.zip`;
    const handle = await requestSaveHandle(fileName, [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }]);
    if (handle === null) return;
    setIsExportingImages(true);
    try {
      const zip = new JSZip();
      sheetPreviews.forEach(({ blob }, index) => zip.file(`纸张${Math.ceil((index + 1) / 2)}_${index % 2 ? '反面' : '正面'}.png`, blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      await saveBlobToHandleOrDownload(blob, fileName, handle);
    } finally { setIsExportingImages(false); }
  };

  if (state.status === 'error') return (
    <div role="alert" className="flex min-h-[420px] flex-col items-center justify-center rounded-[24px] border border-error-border bg-error-bg p-8 text-center">
      <h3 className="font-heading text-2xl text-ink">预览生成失败</h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-error-text">{state.error}</p>
      <button type="button" onClick={() => void runProcessor()} className="mt-6 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-white">重新生成预览</button>
    </div>
  );

  return (
    <section className="relative min-w-0 overflow-visible rounded-[20px] border border-white/85 bg-[#fdfbf8] px-3.5 py-5 shadow-[0_18px_40px_rgba(33,32,15,0.20)] min-[768px]:rounded-[28px] min-[768px]:px-6 min-[768px]:py-6 min-[1367px]:rounded-[32px] min-[1367px]:px-[34px] min-[1367px]:py-8">
      {exportControls(false)}
      {controlsMount ? createPortal(exportControls(true), controlsMount) : null}
      <div className="flex flex-col items-stretch gap-4 min-[768px]:flex-row min-[768px]:flex-wrap min-[768px]:items-center min-[768px]:justify-between min-[768px]:gap-5">
        <div><h2 className="font-heading text-[25px] leading-[38px] text-[#0f1729]">打印预览</h2><p className="mt-[5px] text-sm leading-[21px] text-ink-secondary">已按骑马钉装订方式自动排好页面，可在下方检查成册效果和打印顺序。</p></div>
        <div className="inline-flex w-full max-w-full shrink-0 rounded-full bg-surface-muted p-1 min-[1024px]:w-max">
          <button type="button" onClick={() => setViewMode('reading')} className={`min-h-11 flex-1 touch-manipulation rounded-full px-3 py-2.5 text-[13px] font-medium leading-[20px] transition active:scale-[0.98] min-[1024px]:flex-none min-[1024px]:px-[18px] min-[1367px]:min-h-0 ${viewMode === 'reading' ? 'bg-primary text-[#fdfbf8]' : 'text-ink-secondary hover:text-ink'}`}>翻页模拟</button>
          <button type="button" onClick={() => setViewMode('imposition')} className={`min-h-11 flex-1 touch-manipulation rounded-full px-3 py-2.5 text-[13px] font-medium leading-[20px] transition active:scale-[0.98] min-[1024px]:flex-none min-[1024px]:px-[18px] min-[1367px]:min-h-0 ${viewMode === 'imposition' ? 'bg-primary text-[#fdfbf8]' : 'text-ink-secondary hover:text-ink'}`}>打印纸预览</button>
        </div>
      </div>
      <div className={`mt-5 flex flex-col items-start gap-3 rounded-[14px] border px-3 py-3 min-[768px]:mt-[26px] min-[768px]:flex-row min-[768px]:items-center min-[768px]:gap-[10px] min-[768px]:px-[18px] ${exportsEnabled ? 'border-[#605b42] bg-[#f2f0eb] text-[#605b42]' : 'border-error-border bg-error-bg text-error-text'}`}>
        <img src={`/assets/decorations/${exportsEnabled ? 'info.svg' : 'error.svg'}`} alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
        <p className="flex-1 text-sm font-medium leading-5">{exportsEnabled ? `当前共 ${currentPageCount} 页，已符合骑马钉每 4 页一组的要求，可以直接下载打印。` : removablePageCount > 0 ? `当前共 ${currentPageCount} 页。您可以增加 ${missingPages} 页，或删除 ${removablePageCount} 页，让总页数成为 4 的倍数。` : `当前共 ${currentPageCount} 页，还需增加 ${missingPages} 页，让总页数成为 4 的倍数。`}</p>
        {!exportsEnabled && onFillMissingPages && <div className="flex min-h-11 w-full shrink-0 items-center justify-between gap-1.5 min-[768px]:w-auto min-[768px]:justify-start min-[1367px]:min-h-0"><button type="button" onClick={onFillMissingPages} className="min-h-11 touch-manipulation text-sm font-bold underline underline-offset-4 min-[1367px]:min-h-0">一键补齐空白页</button><div className="group/help relative"><button type="button" aria-label="查看空白页插入位置说明" className="grid h-11 w-11 touch-manipulation place-items-center rounded-full hover:bg-black/5 active:bg-black/10 min-[1367px]:h-6 min-[1367px]:w-6"><img src="/assets/decorations/info-button.svg" alt="" aria-hidden="true" className="h-4 w-4" /></button><div role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-50 hidden w-64 max-w-[calc(100vw-32px)] rounded-lg bg-ink px-3 py-2.5 text-xs font-normal leading-5 text-white shadow-lg group-hover/help:block group-focus-within/help:block min-[1367px]:bottom-auto min-[1367px]:top-[calc(100%+8px)]">空白页会插入到最后一页之前，保留原来的最后一页作为封底。</div></div></div>}
      </div>
      {viewMode === 'reading' && logicalPreviews.length ? (
        <div className="mt-5 flex min-h-[320px] flex-col items-center justify-center rounded-[16px] border border-[#e8e1d7] bg-[#f6f1eb] px-2 py-5 min-[768px]:mt-[26px] min-[768px]:min-h-[460px] min-[768px]:px-4 min-[768px]:py-7 min-[1367px]:h-[522px] min-[1367px]:py-[35px]">
          <div className="flex w-full items-center justify-center gap-4">
            <button type="button" aria-label="上一页" disabled={currentUnitIndex === 0} onClick={() => changeUnit(currentUnitIndex - 1)} className="hidden h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full transition hover:bg-primary-subtle active:scale-95 disabled:cursor-not-allowed disabled:opacity-25 min-[768px]:grid"><img src="/assets/decorations/preview-arrow-left.svg" alt="" aria-hidden="true" className="h-11 w-11" /></button>
            <div
              className="book-stage relative flex h-auto w-full max-w-[710px] touch-pan-y items-stretch justify-center [perspective:1600px] min-[1367px]:h-[418px] min-[1367px]:w-auto"
              style={{ aspectRatio: `${targetDims.width} / ${targetDims.height}` }}
              onTouchStart={event => { const touch = event.changedTouches[0]; touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null; }}
              onTouchEnd={event => {
                const start = touchStartRef.current;
                const touch = event.changedTouches[0];
                touchStartRef.current = null;
                if (!start || !touch) return;
                const deltaX = touch.clientX - start.x;
                const deltaY = touch.clientY - start.y;
                if (Math.abs(deltaX) < 45 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
                changeUnit(currentUnitIndex + (deltaX < 0 ? 1 : -1));
              }}
            >
              <div key={turnKey} style={{ width: readingUnits[currentUnitIndex]?.length === 1 ? '50%' : '100%' }} className={`book-turn book-turn--${turnDirection} flex h-full overflow-hidden rounded-[5px] bg-white shadow-[0_24px_55px_rgba(33,32,15,0.22)]`}>
                {(readingUnits[currentUnitIndex] ?? []).map((page, index) => (
                  <div
                    key={page.pageNum}
                    className={`relative h-full bg-white ${readingUnits[currentUnitIndex].length === 1 ? 'w-full' : 'w-1/2'} ${index === 0 && readingUnits[currentUnitIndex].length > 1 ? 'border-r border-black/10' : ''}`}
                  >
                    <img src={page.url} alt={`第 ${page.pageNum} 页`} className="h-full w-full object-contain" />
                    {readingUnits[currentUnitIndex].length > 1 && (
                      <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 w-8 ${index === 0 ? 'right-0 bg-gradient-to-l' : 'left-0 bg-gradient-to-r'} from-black/10 to-transparent`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button type="button" aria-label="下一页" disabled={currentUnitIndex === readingUnits.length - 1} onClick={() => changeUnit(currentUnitIndex + 1)} className="hidden h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full transition hover:bg-primary-subtle active:scale-95 disabled:cursor-not-allowed disabled:opacity-25 min-[768px]:grid"><img src="/assets/decorations/preview-arrow-right.svg" alt="" aria-hidden="true" className="h-11 w-11" /></button>
          </div>
          <div className="mt-4 flex w-full items-center justify-between px-1 min-[768px]:hidden"><button type="button" aria-label="上一页" disabled={currentUnitIndex === 0} onClick={() => changeUnit(currentUnitIndex - 1)} className="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-surface transition active:scale-95 disabled:opacity-25"><img src="/assets/decorations/preview-arrow-left.svg" alt="" aria-hidden="true" className="h-11 w-11" /></button><span className="text-xs font-medium text-ink-secondary">左右滑动翻页</span><button type="button" aria-label="下一页" disabled={currentUnitIndex === readingUnits.length - 1} onClick={() => changeUnit(currentUnitIndex + 1)} className="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-surface transition active:scale-95 disabled:opacity-25"><img src="/assets/decorations/preview-arrow-right.svg" alt="" aria-hidden="true" className="h-11 w-11" /></button></div>
          <div className="mt-3 flex w-full max-w-[357px] flex-col items-center gap-2 min-[768px]:mt-4"><input aria-label="跳转页面" type="range" min={0} max={Math.max(0, readingUnits.length - 1)} value={currentUnitIndex} onChange={event => changeUnit(Number(event.target.value))} className="h-5 w-full cursor-pointer touch-manipulation accent-primary min-[768px]:h-3" /><span className="text-sm font-medium text-ink-secondary">{pageRangeLabel}</span></div>
        </div>
      ) : viewMode === 'imposition' && !sheetsLoading ? (
        <div className="mt-5 grid grid-cols-1 gap-4 min-[768px]:mt-[26px] min-[768px]:grid-cols-2 min-[768px]:gap-5 min-[1367px]:max-h-[522px] min-[1367px]:overflow-y-auto min-[1367px]:pr-2">{sheetPreviews.map((preview, index) => <article key={index} className="rounded-[16px] border border-border bg-surface p-3 shadow-sm min-[768px]:p-4"><div className="mb-3 flex items-center justify-between text-xs font-semibold text-ink-secondary"><span>纸张 {Math.ceil((index + 1) / 2)}</span><span>{index % 2 ? '背面' : '正面'}</span></div><img src={preview.url} alt={`纸张 ${Math.ceil((index + 1) / 2)} ${index % 2 ? '背面' : '正面'}`} className="aspect-[2/1] w-full rounded-lg bg-surface-muted object-contain" /></article>)}</div>
      ) : (
        <PreviewSkeleton label={viewMode === 'imposition' ? '正在生成打印纸预览…' : '正在生成翻页预览…'} />
      )}
    </section>
  );
};

const ExportButton: React.FC<{ label: string; tip: string; disabled: boolean; onClick: () => void; primary?: boolean }> = ({ label, tip, disabled, onClick, primary }) => {
  const [tipOpen, setTipOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tipOpen) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setTipOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [tipOpen]);

  return (
    <div ref={rootRef} className={`group relative flex h-12 min-w-0 overflow-visible rounded-full text-[14px] font-medium transition min-[768px]:w-auto min-[768px]:text-[16px] ${disabled ? 'opacity-55' : ''} ${primary ? 'bg-secondary text-white hover:bg-secondary-active' : 'border border-[#e4dacf] bg-white text-ink hover:border-primary'}`}>
      <button type="button" disabled={disabled} onClick={onClick} className="min-w-0 flex-1 touch-manipulation whitespace-nowrap rounded-full py-2 px-4 text-center active:scale-[0.98] disabled:cursor-not-allowed min-[1367px]:rounded-l-full min-[1367px]:pl-[22px] min-[1367px]:pr-2">{label}</button>
      <button type="button" aria-label={`查看“${label}”说明`} aria-expanded={tipOpen} onClick={() => setTipOpen(value => !value)} className="hidden h-12 w-10 shrink-0 touch-manipulation place-items-center rounded-r-full pr-1 active:bg-black/10 min-[1367px]:grid min-[1367px]:w-11"><img src="/assets/decorations/info-button.svg" alt="" aria-hidden="true" className={`h-4 w-4 shrink-0 max-w-none ${primary ? 'brightness-0 invert' : ''}`} /></button>
      <div role="tooltip" className={`${tipOpen ? 'block' : 'hidden'} absolute bottom-[calc(100%+8px)] right-0 z-50 w-64 max-w-[calc(100vw-32px)] rounded-lg bg-ink px-3 py-2.5 text-left text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus-within:block min-[1367px]:bottom-auto min-[1367px]:top-[calc(100%+8px)] min-[1367px]:w-72`}>{tip}</div>
    </div>
  );
};

const PreviewSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div aria-live="polite" className="mt-5 h-[320px] animate-pulse rounded-[16px] border border-[#e8e1d7] bg-[#f6f1eb] p-4 min-[768px]:mt-[26px] min-[768px]:h-[430px] min-[768px]:p-6 min-[1367px]:h-[522px] min-[1367px]:p-8">
    <div className="mx-auto h-[220px] w-full max-w-[610px] rounded-[10px] bg-white/80 shadow-sm min-[768px]:h-[320px] min-[1367px]:h-[380px]" />
    <div className="mx-auto mt-7 h-3 w-2/5 rounded-full bg-[#e4dacf]" />
    <p className="mt-4 text-center text-xs font-medium text-ink-muted">{label}</p>
  </div>
);
