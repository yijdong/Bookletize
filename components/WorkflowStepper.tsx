import React, { useState } from 'react';

interface WorkflowStepperProps {
  mode: 'single' | 'spread';
  currentStep: number;
  maxReachableStep?: number;
  onStepClick?: (step: number) => void;
  confirmBeforeStep?: (step: number) => boolean;
  variant?: 'default' | 'home';
}

const stepsByMode = {
  single: ['上传单页 PDF', '整理页面与打印预览'],
  spread: ['上传跨页 PDF', '裁切页面', '整理页面与打印预览'],
};

const mobileLabelsByMode = {
  single: ['上传', '整理与预览'],
  spread: ['上传', '裁切', '整理与预览'],
};

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({ mode, currentStep, maxReachableStep = currentStep, onStepClick, confirmBeforeStep, variant = 'default' }) => {
  const steps = stepsByMode[mode];
  const [confirmingStep, setConfirmingStep] = useState<number | null>(null);
  const selectStep = (step: number) => {
    if (confirmBeforeStep?.(step)) {
      setConfirmingStep(step);
      return;
    }
    onStepClick?.(step);
  };
  return (
    <nav aria-label="制作步骤" className="w-full">
      <ol className={`grid ${variant === 'home' ? 'gap-2 min-[768px]:gap-[22px]' : 'gap-2 min-[768px]:gap-5 min-[1367px]:gap-6'} ${mode === 'spread' ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {steps.map((label, index) => {
          const step = index + 1;
          const complete = step < currentStep;
          const active = step === currentStep;
          const reachable = step <= maxReachableStep;
          return (
            <li key={label} aria-current={active ? 'step' : undefined} className="relative">
              {confirmingStep === step && (
                <div role="alertdialog" aria-label="确认返回上传" className="absolute left-0 top-[calc(100%+8px)] z-[60] w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-surface p-4 text-left shadow-float">
                  <p className="text-sm font-extrabold text-ink">确定返回上传页面吗？</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">返回后会清空已上传的 PDF 和当前编辑内容，需要重新上传文件。</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmingStep(null)} className="rounded-md px-3 py-2 text-xs font-bold text-ink-secondary transition hover:bg-surface-muted">继续整理</button>
                    <button type="button" onClick={() => { setConfirmingStep(null); onStepClick?.(step); }} className="rounded-md bg-error px-3 py-2 text-xs font-bold text-white transition hover:bg-error-text">确认返回</button>
                  </div>
                  <span aria-hidden="true" className="absolute -top-1.5 left-7 h-3 w-3 rotate-45 border-l border-t border-border bg-surface" />
                </div>
              )}
              <button type="button" disabled={!reachable} onClick={() => reachable && selectStep(step)} className={`group min-h-11 w-full touch-manipulation rounded-sm py-1 text-left transition focus-visible:outline-none min-[1367px]:min-h-0 min-[1367px]:py-0 ${reachable ? 'cursor-pointer hover:opacity-75 active:scale-[0.98] active:bg-primary-subtle' : 'cursor-not-allowed opacity-55'}`} aria-label={`${step}. ${label}${active ? '，当前步骤' : complete ? '，已完成' : ''}`}>
                <span aria-hidden="true" className="mb-2 block h-[5px] w-full rounded-full transition-all" style={{ backgroundColor: active || complete ? (variant === 'home' ? '#686C4E' : '#7c9472') : '#f2f0ec' }} />
                <span className={`block text-[10px] font-extrabold leading-[14px] min-[768px]:text-xs ${variant === 'home' ? 'min-[768px]:text-[13px] min-[768px]:font-medium' : ''} ${active ? (variant === 'home' ? 'text-[#686C4E]' : 'text-primary') : complete ? 'text-ink-strong' : 'text-ink-muted'}`}><span className="min-[768px]:hidden">{step}. {mobileLabelsByMode[mode][index]}</span><span className="hidden min-[768px]:inline">{step}. {label}</span></span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
