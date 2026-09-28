import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmBackButtonProps {
  onConfirm: () => void;
  label?: string;
  className?: string;
}

export const ConfirmBackButton: React.FC<ConfirmBackButtonProps> = ({ onConfirm, label = '返回上传', className = '' }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, above: false });

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dialogWidth = 288;
      const dialogHeight = 172;
      const gap = 12;
      const above = rect.top >= dialogHeight + gap + 12;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - dialogWidth - 12)),
        top: above ? rect.top - dialogHeight - gap : rect.bottom + gap,
        above,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node) && !dialogRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      {open && createPortal(
        <div ref={dialogRef} role="alertdialog" aria-label="确认返回上传" style={{ left: position.left, top: position.top }} className="fixed z-[200] w-72 rounded-lg border border-border bg-surface p-4 text-left shadow-float">
          <p className="text-sm font-extrabold text-ink">确定返回上传页面吗？</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">返回后会清空已上传的 PDF 和当前编辑内容，需要重新上传文件。</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-xs font-bold text-ink-secondary transition hover:bg-surface-muted active:scale-[0.98]">继续整理</button>
            <button type="button" onClick={() => { setOpen(false); onConfirm(); }} className="rounded-md bg-error px-3 py-2 text-xs font-bold text-white transition hover:bg-error-text active:scale-[0.98]">确认返回</button>
          </div>
          <span aria-hidden="true" className={`absolute left-7 h-3 w-3 rotate-45 border-border bg-surface ${position.above ? '-bottom-1.5 border-b border-r' : '-top-1.5 border-l border-t'}`} />
        </div>, document.body
      )}
      <button type="button" aria-label={label || '返回上传'} aria-expanded={open} onClick={() => setOpen(value => !value)} className={`inline-flex items-center justify-center gap-2 ${className}`}><img src="/assets/decorations/back-icon.svg" alt="" aria-hidden="true" className="h-4 w-4" />{label && <span>{label}</span>}</button>
    </div>
  );
};
