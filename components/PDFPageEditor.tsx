import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PDFDocument, rgb } from 'pdf-lib';
// Must be the `legacy` build — see the note in PDFCropEditor.tsx. The modern build calls
// native `Map.prototype.getOrInsertComputed` / `Uint8Array.prototype.toHex`, which older
// mobile engines lack; the legacy build polyfills them.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getMissingPageCount, isValidSaddleStitchPageCount } from '../utils/pageCount';
import { ConfirmBackButton } from './ConfirmBackButton';
import { ImpositionEngine } from './ImpositionEngine';
import { TargetDimensions } from '../types';
import { toUserMessage } from '../utils/userMessage';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PDFPageEditorProps {
  file: File;
  targetDims: TargetDimensions;
  onBack: () => void;
  backLabel?: string;
  secondaryAction?: React.ReactNode;
  sourceNotice?: string;
}

interface EditablePage {
  id: string;
  kind: 'source' | 'blank';
  sourceIndex?: number;
  previewUrl?: string;
  width: number;
  height: number;
}

const previewEdge = 560;
const PAGE_RENDER_CONCURRENCY = 4;

export const PDFPageEditor: React.FC<PDFPageEditorProps> = ({ file, targetDims, onBack, backLabel = '重新上传', secondaryAction, sourceNotice }) => {
  const [pages, setPages] = useState<EditablePage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragOverlay, setDragOverlay] = useState<{ pageId: string; left: number; top: number; width: number; height: number } | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [drawerControlsMount, setDrawerControlsMount] = useState<HTMLDivElement | null>(null);
  const [defaultSize, setDefaultSize] = useState({ width: 595.28, height: 841.89 });
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const nextIdRef = useRef(0);
  const draggedIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const nativeDragImageRef = useRef<HTMLElement | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const didInitialBuildRef = useRef(false);
  const buildVersionRef = useRef(0);

  const makeId = (prefix: string) => `${prefix}-${Date.now()}-${nextIdRef.current++}`;

  useEffect(() => () => {
    // go through the drag's own teardown so the rAF loop and its document listeners die together
    dragCleanupRef.current?.();
    nativeDragImageRef.current?.remove();
  }, []);

  const canvasToUrl = (canvas: HTMLCanvasElement) => new Promise<string>((resolve, reject) => {
    canvas.toBlob(blob => {
      // Zero the canvas right after encoding so WebKit releases the backing store
      // immediately. iOS Safari does not reclaim canvas memory on GC alone, and
      // repeated edits otherwise accumulate until the WebContent process is killed.
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) return reject(new Error('无法生成页面预览'));
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.add(url);
      resolve(url);
    }, 'image/jpeg', 0.76);
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setStatus('loading');
      setError(null);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        const loaded: EditablePage[] = new Array(pdf.numPages);
        try {
          const total = pdf.numPages;
          const concurrency = Math.min(PAGE_RENDER_CONCURRENCY, total);
          let nextIndex = 0;
          const renderWorker = async (): Promise<void> => {
            while (true) {
              const pageIndex = nextIndex++;
              if (pageIndex >= total) return;
              const page = await pdf.getPage(pageIndex + 1);
              const base = page.getViewport({ scale: 1 });
              const scale = Math.min(1.15, previewEdge / Math.max(base.width, base.height));
              const viewport = page.getViewport({ scale });
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(viewport.width));
              canvas.height = Math.max(1, Math.round(viewport.height));
              await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
              loaded[pageIndex] = { id: makeId('page'), kind: 'source', sourceIndex: pageIndex, previewUrl: await canvasToUrl(canvas), width: base.width, height: base.height };
            }
          };
          await Promise.all(Array.from({ length: concurrency }, () => renderWorker()));
        } finally {
          await pdf.destroy();
        }
        if (!cancelled) {
          if (loaded[0]) setDefaultSize({ width: loaded[0].width, height: loaded[0].height });
          setPages(loaded);
          setStatus('ready');
        }
      } catch (reason) {
        console.error(reason);
        if (!cancelled) {
          setError(toUserMessage(reason, '无法读取这个 PDF。'));
          setStatus('error');
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, [file]);

  const missingPages = getMissingPageCount(pages.length);
  const isValidCount = isValidSaddleStitchPageCount(pages.length);

  const selectedPageIndex = selectedPageId ? pages.findIndex(page => page.id === selectedPageId) : -1;

  const addBlankAt = (index: number) => {
    const reference = pages[index - 1] ?? pages[index] ?? defaultSize;
    const blank: EditablePage = { id: makeId('blank'), kind: 'blank', width: reference.width, height: reference.height };
    setPages(current => [...current.slice(0, index), blank, ...current.slice(index)]);
  };

  const deletePageAt = (index: number) => {
    const target = pages[index];
    if (!target) return;
    setPages(current => current.filter((_, pageIndex) => pageIndex !== index));
    setSelectedPageId(current => (current === target.id ? null : current));
  };

  const deleteSelectedPage = () => {
    if (selectedPageIndex < 0) return;
    deletePageAt(selectedPageIndex);
  };

  const fillMissingPages = () => {
    if (missingPages === 0) return;
    setPages(current => {
      const reference = current[current.length - 1] ?? defaultSize;
      const insertionIndex = Math.max(0, current.length - 1);
      const blanks = Array.from({ length: missingPages }, () => ({ id: makeId('blank'), kind: 'blank' as const, width: reference.width, height: reference.height }));
      return [...current.slice(0, insertionIndex), ...blanks, ...current.slice(insertionIndex)];
    });
  };

  const movePageToIndex = (insertionIndex: number, sourceId = draggedIdRef.current) => {
    if (!sourceId) return;
    setPages(current => {
      const sourceIndex = current.findIndex(page => page.id === sourceId);
      const dragged = current.find(page => page.id === sourceId);
      if (!dragged || sourceIndex < 0) return current;
      const without = current.filter(page => page.id !== sourceId);
      const targetIndex = Math.max(0, Math.min(without.length, sourceIndex < insertionIndex ? insertionIndex - 1 : insertionIndex));
      return [...without.slice(0, targetIndex), dragged, ...without.slice(targetIndex)];
    });
    setDraggedId(null);
    draggedIdRef.current = null;
    setDropIndex(null);
    dropIndexRef.current = null;
  };

  const updateDropIndex = (next: number | null) => {
    dropIndexRef.current = next;
    setDropIndex(next);
  };

  const getInsertionIndexAtPoint = (clientX: number, clientY: number) => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-page-index]')];
    if (cards.length === 0) return null;
    let closest = cards[0];
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const distanceX = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const distanceY = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const distance = distanceX ** 2 + distanceY ** 2;
      if (distance < closestDistance) {
        closest = card;
        closestDistance = distance;
      }
    }
    const rect = closest.getBoundingClientRect();
    const index = Number(closest.dataset.pageIndex);
    return clientX < rect.left + rect.width / 2 ? index : index + 1;
  };

  const startPointerDrag = (event: React.PointerEvent, pageId: string) => {
    if (event.button !== 0) return;
    // A drag can outlive its own pointerup: iOS drops the event when the touch is
    // interrupted (scroll takeover, system gesture, app switch). Because the auto-scroll
    // loop below reschedules itself, a stale drag keeps an immortal rAF loop and its
    // document listeners alive — the page never goes idle again, Safari decides the
    // WebContent process is unresponsive and kills it, and the reload drops the user
    // back on the home step. Tear down any previous drag before starting a new one.
    dragCleanupRef.current?.();
    event.preventDefault();
    draggedIdRef.current = pageId;
    setDraggedId(pageId);
    const card = event.currentTarget.closest<HTMLElement>('[data-page-index]');
    if (card) {
      const rect = card.getBoundingClientRect();
      dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setDragOverlay({ pageId, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
    const initialIndex = getInsertionIndexAtPoint(event.clientX, event.clientY);
    updateDropIndex(initialIndex);

    // `active` is the loop's own kill switch. It must be checked on every tick, not just
    // at teardown: cancelling a frame only stops the *pending* tick, so a tick already
    // queued to run would otherwise schedule the next one and resurrect the loop.
    let active = true;
    const runAutoScroll = () => {
      if (!active) return;
      const pointerY = pointerYRef.current;
      if (pointerY !== null) {
        const edge = 84;
        const bottomEdge = window.innerHeight - 112;
        const speed = pointerY < edge
          ? -Math.min(18, Math.max(4, (edge - pointerY) / 4))
          : pointerY > bottomEdge
            ? Math.min(18, Math.max(4, (pointerY - bottomEdge) / 4))
            : 0;
        if (speed !== 0) window.scrollBy({ top: speed, behavior: 'auto' });
      }
      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    };
    pointerYRef.current = event.clientY;
    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      pointerYRef.current = pointerEvent.clientY;
      setDragOverlay(current => current ? { ...current, left: pointerEvent.clientX - dragOffsetRef.current.x, top: pointerEvent.clientY - dragOffsetRef.current.y } : current);
      updateDropIndex(getInsertionIndexAtPoint(pointerEvent.clientX, pointerEvent.clientY));
    };
    // Declared as function statements so teardown and the handler can reference each
    // other regardless of order. teardown() is idempotent and does nothing but clean up,
    // so it is safe to call from more than one place (pointerup, pointercancel, the next
    // drag, unmount) and never commits an edit on its own.
    function teardown() {
      if (!active) return;
      active = false;
      pointerYRef.current = null;
      if (autoScrollFrameRef.current !== null) window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', finishPointerDrag);
      document.removeEventListener('pointercancel', finishPointerDrag);
      if (dragCleanupRef.current === teardown) dragCleanupRef.current = null;
    }
    function finishPointerDrag() {
      const target = dropIndexRef.current;
      teardown();
      setDragOverlay(null);
      draggedIdRef.current = null;
      setDraggedId(null);
      if (target !== null) movePageToIndex(target, pageId);
    }
    dragCleanupRef.current = teardown;
    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', finishPointerDrag);
    document.addEventListener('pointercancel', finishPointerDrag);
  };

  const createNativeDragImage = (event: React.DragEvent<HTMLElement>) => {
    nativeDragImageRef.current?.remove();
    const clone = event.currentTarget.cloneNode(true) as HTMLElement;
    const rect = event.currentTarget.getBoundingClientRect();
    clone.style.position = 'fixed';
    clone.style.left = '-9999px';
    clone.style.top = '-9999px';
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.opacity = '0.76';
    clone.style.transform = 'scale(0.98)';
    clone.style.boxShadow = '0 22px 50px rgba(33, 32, 15, 0.28)';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);
    nativeDragImageRef.current = clone;
    event.dataTransfer.setDragImage(clone, event.clientX - rect.left, event.clientY - rect.top);
  };

  const removeNativeDragImage = () => {
    nativeDragImageRef.current?.remove();
    nativeDragImageRef.current = null;
  };

  const buildEditedPdf = async () => {
    if (pages.length === 0) { setPreviewFile(null); return; }
    // Tag each build and discard its result if a newer edit superseded it. Without
    // this, tapping two insert/delete controls inside one debounce window leaves two
    // builds racing; each one emits a File that re-runs the whole imposition
    // pipeline, and on iOS Safari the doubled canvas churn is enough to kill the
    // WebContent process (Safari then reports "a problem repeatedly occurred").
    const version = ++buildVersionRef.current;
    setStatus('saving');
    setError(null);
    try {
      const source = await PDFDocument.load(await file.arrayBuffer());
      const output = await PDFDocument.create();
      for (const page of pages) {
        if (page.kind === 'blank') {
          const blankPage = output.addPage([page.width, page.height]);
          blankPage.drawRectangle({ x: 0, y: 0, width: page.width, height: page.height, color: rgb(1, 1, 1) });
        } else {
          const [copied] = await output.copyPages(source, [page.sourceIndex!]);
          output.addPage(copied);
        }
      }
      const bytes = await output.save();
      if (version !== buildVersionRef.current) return;
      const editedFile = new File([bytes], `${file.name.replace(/\.pdf$/i, '')}_已整理.pdf`, { type: 'application/pdf', lastModified: Date.now() });
      setPreviewFile(editedFile);
      setStatus('ready');
    } catch (reason) {
      if (version !== buildVersionRef.current) return;
      console.error(reason);
      setError(toUserMessage(reason, '生成整理后的 PDF 时出现问题。'));
      setStatus('error');
    }
  };

  useEffect(() => {
    if (!pages.length || (status !== 'ready' && status !== 'saving')) return;
    if (!didInitialBuildRef.current) {
      didInitialBuildRef.current = true;
      void buildEditedPdf();
      return;
    }
    const timer = window.setTimeout(() => { void buildEditedPdf(); }, 260);
    return () => window.clearTimeout(timer);
  // The page model is the source of truth; generation intentionally waits until a drag/edit settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const logicalPagePreviews = useMemo(() => pages.map((page, index) => ({
    pageNum: index + 1,
    url: page.previewUrl ?? 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="3" height="4" viewBox="0 0 3 4"%3E%3Crect width="3" height="4" fill="white"/%3E%3C/svg%3E',
  })), [pages]);

  if (status === 'loading') return (
    <EditorSkeleton fileName={file.name} />
  );

  return (
    <section className="w-full">
      <div className="mb-5 flex min-h-12 flex-col items-start gap-3 min-[768px]:mb-[26px] min-[768px]:gap-4 min-[1367px]:h-12 min-[1367px]:flex-row min-[1367px]:items-center min-[1367px]:justify-between">
        <div className="flex min-w-0 items-center gap-3 min-[768px]:gap-[19px]">{backLabel.includes('上传') ? <ConfirmBackButton onConfirm={onBack} label="" className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-[#e4dacf] bg-white hover:border-primary active:bg-surface-muted min-[1367px]:h-10 min-[1367px]:w-10" /> : <button type="button" onClick={onBack} aria-label={backLabel} className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-[#e4dacf] bg-white hover:border-primary active:bg-surface-muted min-[1367px]:h-10 min-[1367px]:w-10"><img src="/assets/decorations/back-icon.svg" alt="" aria-hidden="true" className="h-6 w-6" /></button>}<div className="min-w-0"><p className="max-w-[calc(100vw-92px)] truncate font-heading text-[20px] leading-8 text-[#0f1729] min-[768px]:max-w-[720px] min-[768px]:text-[25px] min-[768px]:leading-[38px]">{file.name}</p>{sourceNotice && <p className="text-xs text-ink-secondary">{sourceNotice}</p>}</div></div>
        {!secondaryAction && <div />}
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl border border-error-border bg-error-bg px-4 py-3 text-sm font-semibold text-error-text">{error}</p>}

      <div className="flex flex-col gap-4 min-[768px]:gap-6 min-[1367px]:grid min-[1367px]:grid-cols-[242px_minmax(0,1fr)]">
        <aside className={`order-2 fixed bottom-0 left-0 z-[80] flex ${isDrawerOpen ? 'h-[46vh] min-[768px]:h-[360px]' : 'max-h-[110px]'} w-full flex-col rounded-t-[26px] border border-white/85 bg-[#fdfbf8] px-3.5 py-4 shadow-[0_-18px_40px_rgba(33,32,15,0.20)] min-[768px]:rounded-t-[30px] min-[768px]:px-6 min-[768px]:py-5 min-[1367px]:static min-[1367px]:order-none min-[1367px]:h-auto min-[1367px]:max-h-none min-[1367px]:rounded-[32px] min-[1367px]:border-white/85 min-[1367px]:px-6 min-[1367px]:py-8 min-[1367px]:shadow-[0_18px_40px_rgba(33,32,15,0.20)]`}>
          <div className={`flex h-10 shrink-0 items-center justify-between gap-3 ${isDrawerOpen ? 'mb-3 min-[768px]:mb-4 min-[1367px]:mb-5' : ''} min-[1367px]:mb-5 min-[1367px]:h-auto`}>
            <button type="button" onClick={() => setIsDrawerOpen(open => !open)} aria-expanded={isDrawerOpen} className="flex min-w-0 shrink-0 flex-col items-start text-left min-[1367px]:pointer-events-none">
              <span className="flex items-center gap-1.5">
                <span className="font-heading text-[18px] leading-7 text-ink min-[768px]:text-[20px] min-[1367px]:text-[25px] min-[1367px]:leading-[38px]">整理页面</span>
                <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-4 w-4 shrink-0 text-ink transition-transform min-[1367px]:hidden ${isDrawerOpen ? '' : 'rotate-180'}`}><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg>
              </span>
              <span className="hidden text-sm leading-[21px] text-ink-secondary min-[1367px]:mt-[5px] min-[1367px]:block">拖动调整顺序，“+”加入空白页</span>
            </button>
            {!isDrawerOpen && <div ref={setDrawerControlsMount} className="min-w-0 flex-1 min-[1367px]:hidden" />}
            {isDrawerOpen && selectedPageIndex >= 0 && <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => addBlankAt(selectedPageIndex + 1)} aria-label="向右添加空白页" className="grid h-10 w-10 touch-manipulation place-items-center rounded-full border border-border bg-white transition hover:border-primary active:scale-95 min-[1367px]:hidden"><img src="/assets/decorations/blank-page-left.svg" alt="" aria-hidden="true" className="h-6 w-6" /></button><button type="button" onClick={() => addBlankAt(selectedPageIndex)} aria-label="向左添加空白页" className="grid h-10 w-10 touch-manipulation place-items-center rounded-full border border-border bg-white transition hover:border-primary active:scale-95 min-[1367px]:hidden"><img src="/assets/decorations/blank-page-right.svg" alt="" aria-hidden="true" className="h-6 w-6" /></button><button type="button" onClick={deleteSelectedPage} aria-label="删除选中页面" className="grid h-10 w-10 touch-manipulation place-items-center rounded-full border border-error-border bg-white transition hover:bg-error-bg active:scale-95 min-[1367px]:hidden"><img src="/assets/decorations/delete.svg" alt="" aria-hidden="true" className="h-5 w-5" /></button></div>}
          </div>
          {isDrawerOpen && <div className="flex min-h-0 w-full flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin] min-[768px]:gap-4 min-[1367px]:block min-[1367px]:max-h-[680px] min-[1367px]:space-y-0 min-[1367px]:overflow-y-auto min-[1367px]:overflow-x-hidden min-[1367px]:px-1 min-[1367px]:pb-3 min-[1367px]:pr-2">
          {pages.length === 0 && <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface text-center"><p className="text-sm font-bold text-ink-secondary">目前没有页面</p><button type="button" onClick={() => addBlankAt(0)} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white">添加空白页</button></div>}
          {pages.map((page, index) => (
            <div key={page.id} className="relative flex h-full w-[148px] shrink-0 flex-col min-[768px]:w-[164px] min-[1367px]:block min-[1367px]:h-auto min-[1367px]:w-auto">
              <InsertBlankControl active={dropIndex === index} onClick={() => addBlankAt(index)} onDragOver={() => updateDropIndex(index)} onDrop={() => movePageToIndex(index)} />
              {draggedId && dropIndex === index && <div aria-hidden="true" className="absolute -left-[7px] top-1/2 z-20 h-[calc(100%-24px)] -translate-y-1/2 border-l-4 border-primary shadow-[0_0_0_3px_rgba(104,108,78,0.16)] min-[1367px]:hidden" />}
              <article
                draggable
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', page.id);
                  setDraggedId(page.id);
                  draggedIdRef.current = page.id;
                  createNativeDragImage(event);
                }}
                onDragEnd={() => { setDraggedId(null); draggedIdRef.current = null; updateDropIndex(null); removeNativeDragImage(); }}
                onDragOver={event => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  const bounds = event.currentTarget.getBoundingClientRect();
                  updateDropIndex(event.clientX < bounds.left + bounds.width / 2 ? index : index + 1);
                }}
                onDrop={event => {
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const target = event.clientX < bounds.left + bounds.width / 2 ? index : index + 1;
                  movePageToIndex(target, event.dataTransfer.getData('text/plain') || draggedIdRef.current);
                }}
                onClick={() => setSelectedPageId(current => current === page.id ? null : page.id)}
                data-page-index={index}
                className={`group/page flex h-full w-full flex-col overflow-hidden rounded-[14px] border bg-surface shadow-sm transition ${selectedPageId === page.id ? 'border-primary ring-2 ring-primary-subtle' : 'border-border hover:border-primary hover:shadow-md'} ${draggedId === page.id ? 'scale-95 opacity-50 ring-4 ring-primary-subtle' : ''} min-[1367px]:block min-[1367px]:h-auto min-[1367px]:border-border min-[1367px]:ring-0`}
              >
                <div className="relative flex min-h-0 flex-1 items-center justify-center bg-surface-muted p-2 min-[1367px]:aspect-[3/4] min-[1367px]:flex-none">
                  {page.kind === 'blank' ? (
                    <div className="flex h-full w-full items-center justify-center border border-border bg-surface text-xs font-bold text-ink-muted">空白页</div>
                  ) : (
                    <img draggable={false} src={page.previewUrl} alt={`当前第 ${index + 1} 页`} className="h-full w-full select-none object-contain" />
                  )}
                  <button type="button" aria-label={`拖动第 ${index + 1} 页调整顺序`} onPointerDown={event => startPointerDrag(event, page.id)} className="absolute left-1.5 top-1.5 grid h-11 w-11 touch-none cursor-grab select-none place-items-center rounded-lg border border-border bg-surface shadow-md transition hover:border-primary hover:bg-primary-subtle active:cursor-grabbing active:scale-95 min-[768px]:left-2 min-[768px]:top-2 min-[1367px]:h-8 min-[1367px]:w-8"><img src="/assets/decorations/drag.svg" alt="" aria-hidden="true" className="h-5 w-5 min-[1367px]:h-4 min-[1367px]:w-4" /></button>
                  <button type="button" onClick={event => { event.stopPropagation(); deletePageAt(index); }} aria-label={`删除第 ${index + 1} 页`} className="absolute right-1.5 top-1.5 hidden h-11 w-11 touch-manipulation place-items-center rounded-lg border border-error-border bg-surface shadow-md transition hover:bg-error-bg active:scale-90 min-[1367px]:grid min-[768px]:right-2 min-[768px]:top-2 min-[1367px]:h-8 min-[1367px]:w-8"><img src="/assets/decorations/delete.svg" alt="" aria-hidden="true" className="h-5 w-5 min-[1367px]:h-4 min-[1367px]:w-4" /></button>
                </div>
                <div className="flex shrink-0 items-center justify-between px-3 py-2.5"><span className="text-xs font-extrabold text-ink-strong">第 {index + 1} 页</span><span className="text-[10px] font-medium text-ink-muted">{page.kind === 'blank' ? '新增空白' : `原第 ${page.sourceIndex! + 1} 页`}</span></div>
              </article>
              {index === pages.length - 1 && <><InsertBlankControl active={dropIndex === index + 1} onClick={() => addBlankAt(index + 1)} onDragOver={() => updateDropIndex(index + 1)} onDrop={() => movePageToIndex(index + 1)} />{draggedId && dropIndex === index + 1 && <div aria-hidden="true" className="absolute -right-[7px] top-1/2 z-20 h-[calc(100%-24px)] -translate-y-1/2 border-l-4 border-primary shadow-[0_0_0_3px_rgba(104,108,78,0.16)] min-[1367px]:hidden" />}</>}
            </div>
          ))}
          </div>}
          {isDrawerOpen && <div ref={setDrawerControlsMount} className="mt-2 shrink-0 border-t border-[#e4dacf] pt-3 min-[1367px]:hidden" />}
        </aside>
        <div className="order-1 min-w-0 min-[1367px]:order-none">
          {previewFile ? <ImpositionEngine file={previewFile} targetDims={targetDims} exportsEnabled={isValidCount} missingPages={missingPages} onFillMissingPages={fillMissingPages} logicalPagePreviews={logicalPagePreviews} logicalPageCount={pages.length} leadingAction={secondaryAction} controlsMount={drawerControlsMount} controlsCompact={!isDrawerOpen} /> : <PreviewCardSkeleton />}
        </div>
      </div>
      {dragOverlay && createPortal(<DragCardOverlay page={pages.find(page => page.id === dragOverlay.pageId)} index={pages.findIndex(page => page.id === dragOverlay.pageId)} position={dragOverlay} />, document.body)}
    </section>
  );
};

const InsertBlankControl: React.FC<{ onClick: () => void; onDragOver: () => void; onDrop: () => void; active: boolean }> = ({ onClick, onDragOver, onDrop, active }) => (
  <div onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; onDragOver(); }} onDrop={event => { event.preventDefault(); onDrop(); }} className="group/insert relative hidden h-[42px] w-full items-center justify-center min-[1367px]:flex">
    <div aria-hidden="true" className={`absolute left-0 right-0 border-t-2 transition-all ${active ? 'border-solid border-primary ring-2 ring-primary-subtle' : 'border-dashed border-border-strong'}`} />
    <button type="button" onClick={onClick} aria-label="在这里增加空白页" className={`relative z-10 grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-surface shadow-sm transition group-hover/insert:scale-110 group-hover/insert:ring-4 group-hover/insert:ring-primary-subtle min-[1367px]:h-[26px] min-[1367px]:w-[26px] ${active ? 'scale-110 ring-4 ring-primary-subtle' : ''}`}><img src="/assets/decorations/add-blankpage.svg" alt="" aria-hidden="true" className="h-7 w-7 min-[1367px]:h-[26px] min-[1367px]:w-[26px]" /></button>
    <div role="tooltip" className="pointer-events-none absolute bottom-[calc(50%+22px)] left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg group-hover/insert:block group-focus-within/insert:block">在这里增加空白页</div>
  </div>
);

const DragCardOverlay: React.FC<{ page?: EditablePage; index: number; position: { left: number; top: number; width: number; height: number } }> = ({ page, index, position }) => {
  if (!page) return null;
  return <div aria-hidden="true" style={{ left: position.left, top: position.top, width: position.width, height: position.height }} className="pointer-events-none fixed z-[250] overflow-hidden rounded-[14px] border border-primary bg-surface opacity-75 shadow-[0_22px_50px_rgba(33,32,15,0.30)] ring-4 ring-primary-subtle">
    <div className="relative flex aspect-[3/4] items-center justify-center bg-surface-muted p-2">{page.kind === 'blank' ? <div className="flex h-full w-full items-center justify-center border border-border bg-surface text-xs font-bold text-ink-muted">空白页</div> : <img draggable={false} src={page.previewUrl} alt="" className="h-full w-full object-contain" />}</div>
    <div className="flex items-center justify-between px-3 py-2.5"><span className="text-xs font-extrabold text-ink-strong">第 {index + 1} 页</span><span className="text-[10px] font-medium text-ink-muted">{page.kind === 'blank' ? '新增空白' : `原第 ${page.sourceIndex! + 1} 页`}</span></div>
  </div>;
};

export const EditorSkeleton: React.FC<{ fileName: string }> = ({ fileName }) => (
  <section aria-live="polite" className="w-full">
    <div className="mb-5 flex min-h-12 items-center min-[768px]:mb-[26px]"><p className="max-w-[calc(100vw-32px)] truncate font-heading text-[20px] leading-8 text-[#0f1729] min-[768px]:max-w-[720px] min-[768px]:text-[25px] min-[768px]:leading-[38px]">{fileName}</p><span className="sr-only">正在准备 {fileName} 的编辑页面</span></div>
    <div className="flex flex-col gap-4 min-[768px]:gap-6 min-[1367px]:grid min-[1367px]:grid-cols-[242px_minmax(0,1fr)]">
      <aside className="order-2 fixed bottom-0 left-0 z-[80] flex h-[46vh] w-full flex-col rounded-t-[26px] border border-white/85 bg-[#fdfbf8] px-3.5 py-4 shadow-[0_-18px_40px_rgba(33,32,15,0.20)] min-[768px]:h-[360px] min-[768px]:rounded-t-[30px] min-[768px]:px-6 min-[768px]:py-5 min-[1367px]:static min-[1367px]:order-none min-[1367px]:h-auto min-[1367px]:rounded-[32px] min-[1367px]:px-6 min-[1367px]:py-8 min-[1367px]:shadow-[0_18px_40px_rgba(33,32,15,0.20)]"><div className="flex h-10 shrink-0 items-center min-[1367px]:block min-[1367px]:h-auto"><div className="h-8 w-28 animate-pulse rounded-md bg-[#eee7de]" /></div><div className="hidden h-4 w-40 animate-pulse rounded bg-[#f2ece4] min-[1367px]:mt-[5px] min-[1367px]:block" /><div className="mt-3 flex min-h-0 flex-1 gap-3 min-[768px]:mt-4 min-[768px]:gap-4 min-[1367px]:mt-8 min-[1367px]:block min-[1367px]:flex-none min-[1367px]:space-y-4"><div className="h-full w-[148px] shrink-0 animate-pulse rounded-[14px] bg-[#f6f1eb] min-[768px]:w-[164px] min-[1367px]:h-[210px] min-[1367px]:w-full" /><div className="h-full w-[148px] shrink-0 animate-pulse rounded-[14px] bg-[#f6f1eb] min-[768px]:w-[164px] min-[1367px]:h-[210px] min-[1367px]:w-full" /></div></aside>
      <div className="order-1 min-w-0 min-[1367px]:order-none">
        <PreviewCardSkeleton />
      </div>
    </div>
  </section>
);

const PreviewCardSkeleton: React.FC = () => (
  <section className="rounded-[20px] border border-white/85 bg-[#fdfbf8] px-3.5 py-5 shadow-[0_18px_40px_rgba(33,32,15,0.20)] min-[768px]:rounded-[28px] min-[768px]:px-6 min-[768px]:py-6 min-[1367px]:rounded-[32px] min-[1367px]:px-[34px] min-[1367px]:py-8"><div className="h-8 w-28 animate-pulse rounded-md bg-[#eee7de]" /><div className="mt-3 h-4 w-3/5 animate-pulse rounded bg-[#f2ece4]" /><div className="mt-5 h-[320px] animate-pulse rounded-[16px] border border-[#e8e1d7] bg-[#f6f1eb] p-4 min-[768px]:mt-[26px] min-[768px]:h-[430px] min-[768px]:p-6 min-[1367px]:h-[522px] min-[1367px]:p-8"><div className="mx-auto h-[220px] max-w-[610px] rounded-[10px] bg-white/75 min-[768px]:h-[320px] min-[1367px]:h-[390px]" /><div className="mx-auto mt-8 h-3 w-2/5 rounded-full bg-[#e4dacf]" /></div></section>
);
