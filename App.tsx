
import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { PDFCropEditor } from './components/PDFCropEditor';
import { OutputSizeControls } from './components/OutputSizeControls';
import { PDFPageEditor } from './components/PDFPageEditor';
import { WorkflowStepper } from './components/WorkflowStepper';
import { TargetDimensions } from './types';

const App: React.FC = () => {
  const [editingFile, setEditingFile] = useState<File | null>(null);
  const [targetDims, setTargetDims] = useState<TargetDimensions>({ width: 297, height: 210 });
  const [sourceMode, setSourceMode] = useState<'single' | 'spread'>('single');
  const [cropStep, setCropStep] = useState(1);
  const [cropSession, setCropSession] = useState<{ file: File; splitPages: boolean[] } | null>(null);
  const [activeStep, setActiveStep] = useState(1);

  const handleFileSelect = useCallback((selectedFile: File, dims: TargetDimensions) => {
    setEditingFile(selectedFile);
    setTargetDims(dims);
    setActiveStep(2);
  }, []);

  const handleReset = useCallback(() => {
    setEditingFile(null);
    setCropStep(1);
    setCropSession(null);
    setActiveStep(1);
  }, []);

  const currentStep = activeStep;
  const dataReachableStep = sourceMode === 'single'
    ? (editingFile ? 2 : 1)
    : (editingFile ? 3 : cropSession ? 2 : 1);
  const maxReachableStep = Math.max(currentStep, dataReachableStep);
  const isHome = currentStep === 1;
  const goToStep = (step: number) => {
    const hasRequiredData = sourceMode === 'single'
      ? step === 1 || (step === 2 && !!editingFile)
      : step === 1 || (step === 2 && !!cropSession) || (step === 3 && !!editingFile);
    if (step > maxReachableStep || !hasRequiredData) return;

    if (step === 1) {
      setEditingFile(null);
      setCropSession(null);
      setCropStep(1);
    }
    setActiveStep(step);
  };
  const stepper = <WorkflowStepper mode={sourceMode} currentStep={currentStep} maxReachableStep={maxReachableStep} onStepClick={goToStep} confirmBeforeStep={step => step === 1 && currentStep > 1} />;
  const homeStepper = <WorkflowStepper variant="home" mode={sourceMode} currentStep={currentStep} maxReachableStep={maxReachableStep} onStepClick={goToStep} confirmBeforeStep={step => step === 1 && currentStep > 1} />;

  if (isHome) {
    const selectSingle = () => {
      setSourceMode('single');
      setCropStep(1);
      setCropSession(null);
      setActiveStep(1);
      setEditingFile(null);
    };
    const selectSpread = () => {
      setSourceMode('spread');
      setActiveStep(1);
      setEditingFile(null);
    };
    const features = [
      ['home-left-icon1.svg', '自动生成骑马钉页序'],
      ['home-left-icon2.svg', '支持 A4 / 长条纸 / 自定义尺寸'],
      ['home-left-icon3.svg', '跨页 PDF 自动从中缝裁切'],
      ['home-left-icon4.svg', '页面增删、排序与调整'],
      ['home-left-icon5.svg', '在线翻页预览成册效果'],
    ];

    return (
      <div className="min-h-[100dvh] bg-[#f8f2e6] bg-[url('/assets/decorations/home-background.png')] bg-cover bg-[position:58%_center] bg-no-repeat font-body text-[#303225] min-[768px]:bg-center min-[1367px]:min-h-screen">
        <Header onReset={handleReset} showReset={false} isHome />
        <main className="relative mx-auto flex w-full flex-col items-stretch gap-6 px-4 pb-10 pt-3 min-[768px]:max-w-[800px] min-[768px]:gap-8 min-[768px]:px-6 min-[768px]:pb-16 min-[768px]:pt-8 min-[1367px]:w-[1280px] min-[1367px]:max-w-none min-[1367px]:flex-row min-[1367px]:items-start min-[1367px]:justify-between min-[1367px]:gap-0 min-[1367px]:px-0 min-[1367px]:pt-[99px]">
          <video
            key={sourceMode}
            aria-hidden="true"
            autoPlay
            muted
            playsInline
            preload="auto"
            className="pointer-events-none absolute -left-px top-0 z-20 hidden h-[740px] w-[732px] object-contain min-[1367px]:block"
          >
            <source src={`/assets/decorations/${sourceMode === 'single' ? 'animation-single.webm' : 'animation-double.webm'}`} type="video/webm" />
          </video>

          <section className={`relative z-30 order-1 flex w-full flex-col gap-5 transition-[transform,opacity,max-height] duration-300 ease-[cubic-bezier(0,0,0.58,1)] min-[768px]:gap-7 min-[1367px]:order-none min-[1367px]:max-w-[279px] min-[1367px]:gap-[52px] ${sourceMode === 'spread' ? 'min-[1367px]:pointer-events-none min-[1367px]:max-h-0 min-[1367px]:-translate-x-[200px] min-[1367px]:overflow-hidden min-[1367px]:opacity-0' : 'min-[1367px]:max-h-[600px] min-[1367px]:translate-x-0 min-[1367px]:opacity-100'}`}>
            <div className="flex flex-col gap-4 min-[768px]:gap-5 min-[1367px]:gap-6">
              <div className="flex flex-col gap-4">
                <p className="font-brand text-[14px] font-normal leading-[22.5px] text-[#303225]/45">SIMPLE TO A BOOK</p>
                <h1 className="whitespace-nowrap font-heading text-[32px] font-normal leading-[1.3] text-[#303225] min-[768px]:text-[36px] min-[1367px]:text-[40px] min-[1367px]:leading-[48px]">小册子排版助手</h1>
              </div>
              <p className="max-w-[31rem] text-[15px] font-normal leading-7 text-[#303225]/65 min-[768px]:text-[16px] min-[1367px]:max-w-none">上传 PDF，自动整理成可直接双面打印、对折装订的小册子版式。</p>
            </div>
            <ul className="hidden grid-cols-2 gap-x-7 gap-y-3 min-[768px]:grid min-[1367px]:flex min-[1367px]:flex-col min-[1367px]:gap-4">
              {features.map(([icon, label]) => (
                <li key={label} className="flex items-center gap-4">
                  <img src={`/assets/decorations/${icon}`} alt="" aria-hidden="true" className="h-10 w-10 shrink-0" />
                  <span className="whitespace-nowrap text-[14px] font-normal leading-[22.5px] text-[#303225] min-[1367px]:text-[16px]">{label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="relative z-10 order-3 w-full overflow-visible rounded-[24px] border border-white/85 bg-[#fdfbf8] px-4 py-5 shadow-[0_18px_40px_rgba(33,32,15,0.20)] min-[768px]:mx-auto min-[768px]:max-w-[720px] min-[768px]:rounded-[28px] min-[768px]:px-7 min-[768px]:py-8 min-[1367px]:order-none min-[1367px]:mx-0 min-[1367px]:h-[582px] min-[1367px]:w-[655px] min-[1367px]:max-w-none min-[1367px]:rounded-[32px] min-[1367px]:pb-0 min-[1367px]:pl-[106px] min-[1367px]:pr-[35px] min-[1367px]:pt-[53px]">
            <div className="flex w-full flex-col gap-5 min-[768px]:gap-[26px] min-[1367px]:w-[514px]">
              <div className="grid w-full grid-cols-2 gap-2 py-1 min-[768px]:gap-4 min-[1367px]:gap-6" role="tablist" aria-label="选择稿件类型">
                <button type="button" role="tab" aria-selected={sourceMode === 'single'} onClick={selectSingle} className={`flex h-12 w-full min-w-0 items-center justify-center gap-2 rounded-[12px] border px-2 text-[14px] transition active:scale-[0.98] min-[768px]:h-[54px] min-[768px]:gap-3 min-[768px]:px-[22px] min-[768px]:text-[16px] ${sourceMode === 'single' ? 'border-[1.5px] border-[#7c9472] bg-[#e5dfce] font-semibold text-[#605b42]' : 'border-[#e4dacf] bg-white font-medium text-[#303225]/65 hover:border-[#7c9472]'}`}>
                  <img src="/assets/decorations/home-tab-siglepage.svg" alt="" aria-hidden="true" className="h-6 w-6" />
                  单页绘本
                </button>
                <div className="relative w-full min-w-0">
                  <button type="button" role="tab" aria-selected={sourceMode === 'spread'} onClick={selectSpread} className={`flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border px-2 text-[14px] transition active:scale-[0.98] min-[768px]:h-[54px] min-[768px]:gap-3 min-[768px]:px-[22px] min-[768px]:text-[16px] ${sourceMode === 'spread' ? 'border-[1.5px] border-[#7c9472] bg-[#e5dfce] font-semibold text-[#605b42]' : 'border-[#e4dacf] bg-white font-medium text-[#303225]/65 hover:border-[#7c9472]'}`}>
                    <img src="/assets/decorations/home-tab-doublepage.svg" alt="" aria-hidden="true" className="h-6 w-6" />
                    跨页绘本
                  </button>
                </div>
              </div>

              {homeStepper}
              <div className="h-px w-full bg-[#e4dacf]" />
              <OutputSizeControls value={targetDims} onChange={setTargetDims} />
              {sourceMode === 'single' ? (
                <FileUploader onFileSelect={handleFileSelect} dimensions={targetDims} />
              ) : (
                <PDFCropEditor key="spread-upload" embedded homeVariant targetDims={targetDims} onEditedFile={setEditingFile} onStepChange={step => { setCropStep(step); setActiveStep(step); }} initialSession={null} onSessionChange={setCropSession} />
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#f6f0e8] bg-[url('/assets/decorations/background-otherpage.png')] bg-cover bg-center bg-no-repeat bg-scroll font-body text-ink min-[1367px]:min-h-screen min-[1367px]:bg-fixed">
      <Header onReset={handleReset} showReset={!!editingFile || !!cropSession} />
      
      <main className="relative mx-auto flex w-full max-w-[1158px] flex-1 flex-col px-3 pb-[calc(46vh+2rem)] pt-5 min-[768px]:px-6 min-[768px]:pb-[390px] min-[768px]:pt-8 min-[1367px]:px-0 min-[1367px]:pb-24 min-[1367px]:pt-[29px]">
        <div className="w-full">
          {sourceMode === 'spread' && <div className="absolute left-1/2 top-[-41px] z-[90] hidden w-[1057px] -translate-x-[417px] min-[1367px]:block">{stepper}</div>}

          {currentStep === (sourceMode === 'single' ? 2 : 3) && editingFile ? (
              <>
                <PDFPageEditor file={editingFile} targetDims={targetDims} onBack={() => goToStep(sourceMode === 'spread' ? 2 : 1)} backLabel={sourceMode === 'spread' ? '返回裁切页面' : '返回上传'} />
              </>
          ) : currentStep === 1 ? <>
            <div className="hidden min-[1367px]:mb-6 min-[1367px]:block min-[1367px]:border-b min-[1367px]:border-border-subtle min-[1367px]:pb-5">{stepper}</div>

            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <OutputSizeControls value={targetDims} onChange={setTargetDims} />
              <p className="pb-2 text-xs text-ink-muted">尺寸会用于最后生成的骑马钉打印稿</p>
            </div>

            {sourceMode === 'single' ? (
              <FileUploader onFileSelect={handleFileSelect} dimensions={targetDims} />
            ) : (
              <PDFCropEditor key="spread-upload" embedded targetDims={targetDims} onEditedFile={setEditingFile} onStepChange={step => { setCropStep(step); setActiveStep(step); }} initialSession={null} onSessionChange={setCropSession} />
            )}
            </> : sourceMode === 'spread' && (currentStep === 2 || (currentStep === 3 && !editingFile)) ? (
              <PDFCropEditor key="spread-editor" embedded requestedStep={currentStep} targetDims={targetDims} onEditedFile={setEditingFile} onStepChange={step => { setCropStep(step); setActiveStep(step); }} initialSession={cropSession} onSessionChange={setCropSession} />
            ) : null}
        </div>
      </main>

      <footer className="py-5 text-center text-xs text-ink-muted">
        © {new Date().getFullYear()} 绘本排版助手 • 简单的步骤，享受制作书本的乐趣
      </footer>
    </div>
  );
};

export default App;
