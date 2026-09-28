import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export const FloatingActionBar = ({ children }: { children: ReactNode }) => createPortal(
  <div className="fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-[100] flex w-[calc(100%-24px)] max-w-[1158px] -translate-x-1/2 flex-col gap-2 rounded-[16px] border border-border bg-surface p-2.5 shadow-float min-[768px]:flex-row min-[768px]:items-center min-[768px]:justify-between min-[768px]:gap-3 min-[1367px]:bottom-5 min-[1367px]:w-[calc(100%-2rem)] min-[1367px]:p-3">
    {children}
  </div>,
  document.body,
);
