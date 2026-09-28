import React from 'react';

interface HeaderProps {
  onReset: () => void;
  showReset: boolean;
  isHome?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onReset }) => (
  <header className="relative z-50 mx-auto flex h-[68px] w-full items-center justify-between px-4 min-[768px]:h-[78px] min-[768px]:px-6 min-[1367px]:h-[86px] min-[1367px]:w-[1280px] min-[1367px]:px-0">
    <button type="button" onClick={onReset} aria-label="返回首页" className="h-[52px] w-[134px] touch-manipulation overflow-hidden text-left transition-opacity hover:opacity-75 active:opacity-60 min-[1367px]:h-16 min-[1367px]:w-[162px]">
      <img src="/assets/decorations/logo.png" alt="Booklet" className="h-[52px] w-auto max-w-none -translate-x-7 object-contain min-[1367px]:h-16 min-[1367px]:-translate-x-9" />
    </button>
  </header>
);
