import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
// Must be the `legacy` build — do not "upgrade" these two imports. The modern build calls
// `Map.prototype.getOrInsertComputed` and `Uint8Array.prototype.toHex` as bare native
// methods; both only reached JS engines in late 2025, so on the Huawei browser and other
// older mobile engines PDF loading dies with "a.toHex is not a function" or
// "i(...).getOrInsertComputed is not a function". The legacy build ships core-js polyfills
// for exactly these two.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { validatePdfFile } from './FileUploader';
import { getEmbedBounds } from '../utils/pdfGeometry';
import { EditorSkeleton, PDFPageEditor } from './PDFPageEditor';
import { ConfirmBackButton } from './ConfirmBackButton';
import { FloatingActionBar } from './ui/FloatingActionBar';
import { BorderBeamPanel } from './ui/border-beam-panel';
import { TargetDimensions } from '../types';
import { requestSaveHandle, saveBlobToHandleOrDownload } from '../utils/saveFile';
import { toUserMessage } from '../utils/userMessage';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PDFCropEditorProps {
  onBack?: () => void;
  onEditedFile?: (file: File | null) => void;
  targetDims: TargetDimensions;
  embedded?: boolean;
  initialSession?: { file: File; splitPages: boolean[] } | null;
  onSessionChange?: (session: { file: File; splitPages: boolean[] } | null) => void;
  onStepChange?: (step: number) => void;
  requestedStep?: number;
  homeVariant?: boolean;
}

interface PagePreview {
  pageNumber: number;
  url: string;
  width: number;
  height: number;
}

type EditorStatus = 'idle' | 'loading' | 'preview' | 'processing' | 'done' | 'error';

const MAX_PREVIEW_EDGE = 760;

export const PDFCropEditor: React.FC<PDFCropEditorProps> = ({ onBack, onEditedFile, targetDims, embedded = false, initialSession, onSessionChange, onStepChange, requestedStep, homeVariant = false }) => {
  const [status, setStatus] = useState<EditorStatus>(initialSession && !homeVariant ? 'loading' : 'idle');
  const [file, setFile] = useState<File | null>(initialSession?.file ?? null);
  const [sourcePreviews, setSourcePreviews] = useState<PagePreview[]>([]);
  const [splitPages, setSplitPages] = useState<boolean[]>([]);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDownloadingResult, setIsDownloadingResult] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const previousRequestedStepRef = useRef(requestedStep);

  const createPreviewUrl = (canvas: HTMLCanvasElement) => new Promise<string>((resolve, reject) => {
    canvas.toBlob(blob => {
      // Zero the canvas right after encoding so WebKit releases the backing store
      // immediately. iOS Safari does not reclaim canvas memory on GC alone, and
      // this loop runs once per page, so the leak scales with document length.
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) {
        reject(new Error('无法生成页面预览'));
        return;
      }
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.add(url);
      resolve(url);
    }, 'image/jpeg', 0.78);
  });

  const clearObjectUrls = () => {
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  };

  useEffect(() => () => clearObjectUrls(), []);

  useEffect(() => {
    const reportedStep = status === 'loading' && file ? 2 : status === 'preview' ? 2 : status === 'processing' || status === 'done' ? 3 : initialSession ? 2 : 1;
    onStepChange?.(reportedStep);
  }, [status, initialSession, onStepChange]);

  const renderPdfPages = async (data: Uint8Array): Promise<PagePreview[]> => {
    const pdf = await pdfjs.getDocument({ data }).promise;
    const previews: PagePreview[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.25, MAX_PREVIEW_EDGE / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        previews.push({ pageNumber, url: await createPreviewUrl(canvas), width: base.width, height: base.height });
      }
      return previews;
    } finally {
      await pdf.destroy();
    }
  };

  const loadFile = async (selectedFile: File, restoredSplitPages?: boolean[]) => {
    setError(null);
    const validationError = await validatePdfFile(selectedFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    setFile(selectedFile);
    setStatus('loading');
    onSessionChange?.({ file: selectedFile, splitPages: restoredSplitPages ?? [] });
    if (homeVariant) return;
    clearObjectUrls();
    setSourcePreviews([]);
    setResultBlob(null);
    try {
      const bytes = new Uint8Array(await selectedFile.arrayBuffer());
      const previews = await renderPdfPages(bytes);
      const nextSplitPages = restoredSplitPages?.length === previews.length ? [...restoredSplitPages] : previews.map(() => true);
      setSourcePreviews(previews);
      setSplitPages(nextSplitPages);
      onSessionChange?.({ file: selectedFile, splitPages: nextSplitPages });
      setStatus('preview');
    } catch (reason) {
      console.error(reason);
      setError(toUserMessage(reason, '无法打开这个 PDF，请换一个文件重试。'));
      setStatus('error');
    }
  };

  const restoredSessionRef = useRef(false);
  useEffect(() => {
    if (!initialSession || restoredSessionRef.current) return;
    restoredSessionRef.current = true;
    void loadFile(initialSession.file, initialSession.splitPages);
  }, [initialSession]);

  const resultPageCount = useMemo(() => splitPages.reduce((total, split) => total + (split ? 2 : 1), 0), [splitPages]);
  const croppedFileName = `${(file?.name ?? '').replace(/\.pdf$/i, '')}_已拆成单页.pdf`;
  const allPagesSplit = splitPages.length > 0 && splitPages.every(Boolean);
  const somePagesSplit = splitPages.some(Boolean) && !allPagesSplit;

  const updateSplitPages = (next: boolean[]) => {
    setSplitPages(next);
    setResultBlob(null);
    setCroppedFile(null);
    if (file) onSessionChange?.({ file, splitPages: next });
  };

  const createCroppedPdf = async () => {
    if (!file) throw new Error('请先上传需要裁切的 PDF。');
    const sourceBytes = await file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(sourceBytes);
    const outputPdf = await PDFDocument.create();

    for (let index = 0; index < sourcePdf.getPageCount(); index++) {
      const sourcePage = sourcePdf.getPage(index);
      if (!splitPages[index]) {
        const [copiedPage] = await outputPdf.copyPages(sourcePdf, [index]);
        outputPdf.addPage(copiedPage);
      } else {
        const box = sourcePage.getCropBox();
        const halfWidth = box.width / 2;
        for (const half of ['left', 'right'] as const) {
          const embedded = await outputPdf.embedPage(sourcePage, getEmbedBounds(box, half));
          const outputPage = outputPdf.addPage([halfWidth, box.height]);
          outputPage.drawPage(embedded, { x: 0, y: 0, width: halfWidth, height: box.height });
        }
      }
    }
    return outputPdf.save();
  };

  const startCropping = async () => {
    if (!file) return;
    onSessionChange?.({ file, splitPages: [...splitPages] });
    setStatus('processing');
    setError(null);
    try {
      const outputBytes = await createCroppedPdf();
      const blob = new Blob([outputBytes], { type: 'application/pdf' });
      setResultBlob(blob);
      const nextFile = new File([blob], croppedFileName, { type: 'application/pdf', lastModified: Date.now() });
      setCroppedFile(nextFile);
      setStatus('done');
      // Hand off immediately: PDFPageEditor renders its own previews from the cropped PDF.
      onEditedFile?.(nextFile);
    } catch (reason) {
      console.error(reason);
      setError(toUserMessage(reason, '裁切时出现问题，请重新上传后再试。'));
      setStatus('preview');
    }
  };

  const reset = () => {
    clearObjectUrls();
    setStatus('idle');
    setFile(null);
    setSourcePreviews([]);
    setResultBlob(null);
    setCroppedFile(null);
    setSplitPages([]);
    setError(null);
    onSessionChange?.(null);
    onEditedFile?.(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const backToSplitPreview = () => {
    setStatus('preview');
    setResultBlob(null);
    setCroppedFile(null);
    setError(null);
  };

  useEffect(() => {
    const previousStep = previousRequestedStepRef.current;
    previousRequestedStepRef.current = requestedStep;
    if (previousStep === 3 && requestedStep === 2 && status === 'done') backToSplitPreview();
  }, [requestedStep, status]);

  const downloadResult = async () => {
    if (!file || isDownloadingResult) return;
    const fileName = `${file.name.replace(/\.pdf$/i, '')}_已拆成单页.pdf`;
    const handle = await requestSaveHandle(fileName, [{ description: 'PDF 文件', accept: { 'application/pdf': ['.pdf'] } }]);
    if (handle === null) return;
    setIsDownloadingResult(true);
    setError(null);
    try {
      const blob = resultBlob ?? new Blob([await createCroppedPdf()], { type: 'application/pdf' });
      setResultBlob(blob);
      await saveBlobToHandleOrDownload(blob, fileName, handle);
    } catch (reason) {
      console.error(reason);
      setError(toUserMessage(reason, '生成裁切 PDF 时出现问题，请重试。'));
    } finally {
      setIsDownloadingResult(false);
    }
  };

  const uploadZone = (
    <div
      onDragOver={event => { event.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={event => { event.preventDefault(); setIsDragging(false); if (event.dataTransfer.files[0]) void loadFile(event.dataTransfer.files[0]); }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click(); } }}
      role="button"
      tabIndex={0}
      aria-label="上传需要拆分的 PDF"
      className={`flex w-full cursor-pointer touch-manipulation flex-col items-center justify-center text-center transition-all duration-state ease-gentle ${homeVariant ? 'h-[220px] gap-3 rounded-[18px] border-2 border-dashed border-[rgba(191,108,73,0.4)] bg-[#f5efe6] px-4 active:bg-secondary-subtle min-[768px]:h-[230px] min-[768px]:gap-4 min-[768px]:rounded-[22px]' : 'h-[220px] rounded-[18px] bg-surface px-4 min-[768px]:h-64 min-[768px]:rounded-lg min-[768px]:px-6'} ${isDragging ? (homeVariant ? 'border-secondary bg-secondary-subtle' : 'bg-primary-subtle ring-2 ring-primary') : homeVariant ? 'hover:border-secondary' : 'hover:bg-surface-muted'}`}
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={event => {
        const selected = event.target.files?.[0];
        // Clear the input before loading so that picking the SAME file again still fires
        // change. Browsers skip change when the value is unchanged, and loadFile returns
        // early on both a validation failure and a PDF parse failure — so without this a
        // user whose file failed to open could never retry that file.
        event.target.value = '';
        if (selected) void loadFile(selected);
      }} />
      <img src="/assets/decorations/home-upload.svg" alt="" aria-hidden="true" className={homeVariant ? 'h-12 w-12 min-[768px]:h-[54px] min-[768px]:w-[54px]' : 'mb-3 h-12 w-12 min-[768px]:mb-4 min-[768px]:h-[54px] min-[768px]:w-[54px]'} />
      <p className={homeVariant ? 'text-[17px] font-semibold leading-7 text-[#303225] min-[768px]:text-[20px] min-[768px]:leading-[30px]' : 'text-[17px] font-bold text-ink min-[768px]:text-lg'}>{homeVariant ? <><span className="min-[768px]:hidden">点击选择 PDF 文件</span><span className="hidden min-[768px]:inline">点击上传或拖拽 PDF 文件到这里</span></> : '上传需要拆成单页的 PDF'}</p>
      <p className={homeVariant ? 'text-[14px] leading-[18px] text-[#303225]/65' : 'mt-2 max-w-lg text-sm leading-relaxed text-ink-secondary'}>{homeVariant ? '仅支持PDF格式 · 最大 200 MB' : '适合一页里同时放了左右两幅画的连页稿。上传后可以逐页确认，封面、封底等单独页面可选择保持不变。'}</p>
    </div>
  );

  return (
    <div className={`w-full ${embedded ? '' : 'max-w-6xl pb-16'}`}>
      {!embedded && (
        <div className="mb-6 flex items-center gap-4">
          {onBack && <button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-ink-secondary shadow-sm hover:border-primary hover:text-primary-active">
            <img src="/assets/decorations/back-icon.svg" alt="" aria-hidden="true" className="h-4 w-4" />
            返回排版首页
          </button>}
          <div>
            <h1 className="text-xl font-extrabold text-ink md:text-2xl">连页稿拆成单页</h1>
            <p className="text-sm text-ink-secondary">默认从每页正中间分开，也可以指定某一页保持原样。</p>
          </div>
        </div>
      )}

      {error && <div role="alert" className="mb-5 flex items-start gap-3 rounded-[14px] border border-error-border bg-error-bg px-[18px] py-3 text-sm font-semibold text-error-text"><img src="/assets/decorations/error.svg" alt="" aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" /><span>裁切没有完成：{error}</span></div>}

      {(status === 'idle' || status === 'loading' || status === 'error') && (
        <div className="w-full">
          {status === 'loading' ? (homeVariant ? null : <CropPreviewSkeleton fileName={file?.name ?? ''} onBack={reset} />) : homeVariant ? uploadZone : <BorderBeamPanel beams={2} thickness={2} radius={20} glow className="p-[2px]">{uploadZone}</BorderBeamPanel>}
        </div>
      )}

      {status === 'preview' && (
        <>
          <CropFileHeader fileName={file?.name ?? ''} onBack={reset} />
          <section className="rounded-[20px] border border-white/85 bg-[#fdfbf8] px-3.5 py-5 shadow-[0_18px_40px_rgba(33,32,15,0.20)] min-[768px]:rounded-[28px] min-[768px]:px-6 min-[768px]:py-6 min-[1367px]:rounded-[32px] min-[1367px]:px-[34px] min-[1367px]:py-8">
          <div className="mb-[26px]"><h1 className="font-heading text-[25px] leading-[38px] text-ink">裁切页面</h1><p className="mt-[5px] text-sm leading-[21px] text-ink-secondary">原文件 {sourcePreviews.length} 页 · 完成后得到 {resultPageCount} 个单页</p></div>
          <div className="mb-5 flex items-start gap-[10px] rounded-[14px] border border-[#605b42] bg-[#f2f0eb] px-3 py-3 min-[768px]:mb-[26px] min-[768px]:items-center min-[768px]:px-[18px]">
            <div className="flex items-center gap-[10px]"><img src="/assets/decorations/info.svg" alt="" aria-hidden="true" className="h-6 w-6" /><p className="text-sm font-medium leading-[20px] text-[#605b42]">默认从中间裁切，如有封面封底是单页的可以关闭裁切开关</p></div>
          </div>

          <div className="grid grid-cols-1 gap-4 min-[768px]:grid-cols-2 min-[768px]:gap-5 min-[1367px]:grid-cols-3">
            {sourcePreviews.map((preview, index) => (
              <article key={preview.pageNumber} className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
                <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-muted p-3">
                  <img src={preview.url} alt={`原文件第 ${preview.pageNumber} 页`} className="h-full w-full object-contain" />
                  {splitPages[index] && (
                    <div aria-hidden="true" className="absolute bottom-3 left-1/2 top-3 border-l-2 border-dashed border-secondary shadow-[0_0_0_1px_rgba(255,255,255,0.8)]">
                      <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-error px-2 py-1 text-[10px] font-bold text-white">从这里分开</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-bold text-ink">第 {preview.pageNumber} 页</p>
                    <p className="mt-0.5 text-xs text-ink-secondary">{splitPages[index] ? '拆成左、右两个单页' : '整页保留，不做拆分'}</p>
                  </div>
                  <button type="button" role="switch" aria-checked={splitPages[index]} aria-label={`第 ${preview.pageNumber} 页是否拆分`} onClick={() => updateSplitPages(splitPages.map((value, pageIndex) => pageIndex === index ? !value : value))} className="grid h-11 w-14 shrink-0 touch-manipulation place-items-center rounded-full active:bg-primary-subtle min-[1367px]:h-7 min-[1367px]:w-12">
                    <span className={`relative block h-7 w-12 rounded-full transition ${splitPages[index] ? 'bg-primary' : 'bg-border-strong'}`}><span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-surface shadow transition-transform ${splitPages[index] ? 'translate-x-6' : 'translate-x-1'}`} /></span>
                  </button>
                </div>
              </article>
            ))}
          </div>
          </section>
          <FloatingActionBar>
            <div className="flex min-h-11 w-full items-center justify-between gap-3 min-[768px]:w-auto min-[768px]:justify-start"><span className="text-sm font-semibold text-ink-secondary">{somePagesSplit ? '部分裁切' : allPagesSplit ? '全部裁切' : '全部保留原页'}</span><button type="button" role="switch" aria-checked={allPagesSplit} aria-label="切换全部页面是否裁切" onClick={() => updateSplitPages(sourcePreviews.map(() => !allPagesSplit))} className="grid h-11 w-14 shrink-0 touch-manipulation place-items-center rounded-full active:bg-primary-subtle"><span className={`relative block h-8 w-12 rounded-full transition ${allPagesSplit ? 'bg-primary' : somePagesSplit ? 'bg-secondary' : 'bg-border-strong'}`}><span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${allPagesSplit ? 'translate-x-4' : somePagesSplit ? 'translate-x-2' : 'translate-x-0'}`} /></span></button></div>
            <div className="grid w-full grid-cols-1 gap-2 min-[768px]:w-auto min-[768px]:grid-cols-2 min-[1367px]:flex min-[1367px]:flex-wrap min-[1367px]:justify-end">
              <button type="button" disabled={isDownloadingResult} onClick={() => void downloadResult()} className="min-h-11 w-full rounded-xl border border-[#e4dacf] bg-white px-4 py-3 text-sm font-bold text-ink transition hover:border-primary active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 min-[1367px]:w-auto min-[1367px]:px-5">{isDownloadingResult ? '正在准备裁切 PDF…' : '下载裁切后的 PDF'}</button>
              <button type="button" onClick={() => void startCropping()} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-primary-active active:scale-[0.98] min-[1367px]:w-auto min-[1367px]:px-6">下一步：整理页面与打印预览 →</button>
            </div>
          </FloatingActionBar>
        </>
      )}

      {status === 'processing' && <EditorSkeleton fileName={croppedFileName} />}

      {status === 'done' && croppedFile && (
        <>
          <PDFPageEditor file={croppedFile} targetDims={targetDims} onBack={backToSplitPreview} backLabel="返回裁切页面" sourceNotice={`跨页稿已裁切为 ${resultPageCount} 个单页。`} />
        </>
      )}
    </div>
  );
};

const CropFileHeader: React.FC<{ fileName: string; onBack: () => void; confirm?: boolean }> = ({ fileName, onBack, confirm = true }) => (
  <div className="mb-5 flex min-h-12 min-w-0 items-center gap-3 min-[768px]:mb-[26px] min-[768px]:gap-[19px]">
    {confirm ? <ConfirmBackButton onConfirm={onBack} label="" className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-[#e4dacf] bg-white hover:border-primary active:bg-surface-muted min-[1367px]:h-10 min-[1367px]:w-10" /> : <button type="button" onClick={onBack} aria-label="返回裁切页面" className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-[#e4dacf] bg-white hover:border-primary active:bg-surface-muted min-[1367px]:h-10 min-[1367px]:w-10"><img src="/assets/decorations/back-icon.svg" alt="" aria-hidden="true" className="h-6 w-6" /></button>}
    <p className="max-w-[calc(100vw-88px)] truncate font-heading text-[20px] leading-8 text-[#0f1729] min-[768px]:max-w-[720px] min-[768px]:text-[25px] min-[768px]:leading-[38px]">{fileName}</p>
  </div>
);

const CropPreviewSkeleton: React.FC<{ fileName: string; onBack: () => void }> = ({ fileName, onBack }) => (
  <div aria-live="polite">
    <CropFileHeader fileName={fileName} onBack={onBack} />
    <section className="rounded-[20px] border border-white/85 bg-[#fdfbf8] px-3.5 py-5 shadow-[0_18px_40px_rgba(33,32,15,0.20)] min-[768px]:rounded-[28px] min-[768px]:px-6 min-[768px]:py-6 min-[1367px]:rounded-[32px] min-[1367px]:px-[34px] min-[1367px]:py-8">
      <div className="flex flex-col items-start gap-2 min-[768px]:flex-row min-[768px]:items-center min-[768px]:justify-between"><div><h1 className="font-heading text-[22px] leading-[34px] text-ink min-[768px]:text-[25px] min-[768px]:leading-[38px]">裁切页面</h1><p className="mt-[5px] text-sm leading-[21px] text-ink-secondary">正在读取页面并生成裁切预览…</p></div><div className="flex items-center gap-2 text-xs font-medium text-[#686C4E]"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#686C4E]/25 border-t-[#686C4E]" />准备中</div></div>
      <div className="mt-5 flex min-h-12 items-start gap-[10px] rounded-[14px] border border-[#605b42] bg-[#f2f0eb] px-3 py-3 min-[768px]:mt-[26px] min-[768px]:items-center min-[768px]:px-[18px]"><img src="/assets/decorations/info.svg" alt="" aria-hidden="true" className="h-6 w-6 shrink-0" /><p className="text-sm font-medium leading-5 text-[#605b42]">默认从中间裁切，如有封面封底是单页的可以关闭裁切开关</p></div>
      <div className="mt-5 grid grid-cols-1 gap-4 min-[768px]:mt-[26px] min-[768px]:grid-cols-2 min-[768px]:gap-5 min-[1367px]:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-border bg-surface"><div className="aspect-[4/3] animate-pulse bg-[#f6f1eb]" /><div className="flex items-center justify-between p-4"><div className="h-4 w-16 animate-pulse rounded bg-[#eee7de]" /><div className="h-7 w-12 animate-pulse rounded-full bg-[#e4dacf]" /></div></div>)}
      </div>
    </section>
  </div>
);
