import React from 'react';
import { TargetDimensions } from '../types';

interface OutputSizeControlsProps {
  value: TargetDimensions;
  onChange: (value: TargetDimensions) => void;
}

export const OutputSizeControls: React.FC<OutputSizeControlsProps> = ({ value, onChange }) => (
  <div className="grid w-full grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-end gap-x-2 gap-y-3 min-[768px]:flex min-[768px]:gap-[14px]">
    <label className="relative block h-[48px] w-full min-w-0 min-[768px]:h-[44px] min-[768px]:w-[131px] min-[768px]:shrink-0">
      <span className="sr-only">打印纸宽度</span>
      <input aria-label="打印纸宽度" type="number" min="10" max="2000" step="0.1" inputMode="decimal" value={value.width} onChange={event => onChange({ ...value, width: Number(event.target.value) })} className="h-full w-full rounded-[12px] border border-[#e4dacf] bg-white/85 px-[14px] pr-11 font-numeric text-[16px] font-bold text-[#303225] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-subtle" />
      <span className="pointer-events-none absolute right-[14px] top-[13px] text-[12px] font-medium text-[#303225]/45">mm</span>
    </label>
    <span className="flex h-[48px] w-6 shrink-0 items-center justify-center text-[17px] font-medium leading-none text-[#303225]/45 min-[768px]:h-[44px] min-[768px]:w-[22px] min-[1367px]:text-[15px]">×</span>
    <label className="relative block h-[48px] w-full min-w-0 min-[768px]:h-[44px] min-[768px]:w-[131px] min-[768px]:shrink-0">
      <span className="sr-only">高度</span>
      <input aria-label="高度" type="number" min="10" max="2000" step="0.1" inputMode="decimal" value={value.height} onChange={event => onChange({ ...value, height: Number(event.target.value) })} className="h-full w-full rounded-[12px] border border-[#e4dacf] bg-white/85 px-[14px] pr-11 font-numeric text-[16px] font-bold text-[#303225] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-subtle" />
      <span className="pointer-events-none absolute right-[14px] top-[13px] text-[12px] font-medium text-[#303225]/45">mm</span>
    </label>
    <div className="col-span-3 grid grid-cols-2 gap-2 min-[768px]:contents">
      <button type="button" onClick={() => onChange({ width: 297, height: 210 })} className={`h-[44px] min-w-0 rounded-full border-[1.5px] px-3 text-[14px] font-medium transition-colors active:scale-[0.98] min-[768px]:shrink-0 min-[768px]:px-[22px] ${value.width === 297 && value.height === 210 ? 'border-primary bg-[#f2f0ec] text-[#303225]' : 'border-transparent bg-[#f2f0ec] text-[#303225]/65 hover:border-primary'}`}>A4 横向</button>
      <button type="button" onClick={() => onChange({ width: 420, height: 210 })} className={`h-[44px] min-w-0 rounded-full border-[1.5px] px-3 text-[14px] font-medium transition-colors active:scale-[0.98] min-[768px]:shrink-0 min-[768px]:px-[22px] ${value.width === 420 && value.height === 210 ? 'border-primary bg-[#f2f0ec] text-[#303225]' : 'border-transparent bg-[#f2f0ec] text-[#303225]/65 hover:border-primary'}`}>长条纸</button>
    </div>
  </div>
);
