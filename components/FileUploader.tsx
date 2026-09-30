import React, { useRef, useState } from 'react';
import { TargetDimensions } from '../types';

interface FileUploaderProps {
  onFileSelect: (file: File, dimensions: TargetDimensions) => void;
  dimensions: TargetDimensions;
}

const MAX_FILE_SIZE = 200 * 1024 * 1024;

export const validatePdfFile = async (file: File): Promise<string | null> => {
  if (file.size === 0) return '这个文件是空的，请重新选择 PDF。';
  if (file.size > MAX_FILE_SIZE) return 'PDF 不能超过 200 MB。建议先压缩文件后再上传。';
  const signature = new TextDecoder('ascii').decode(await file.slice(0, 5).arrayBuffer());
  return signature === '%PDF-' ? null : '所选文件不是有效的 PDF。';
};

export const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, dimensions }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndSelect = async (selectedFile: File) => {
    setError(null);
    if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width < 10 || dimensions.height < 10) {
      setError('输出宽度和高度都必须至少为 10 mm。');
      return;
    }
    if (dimensions.width > 2000 || dimensions.height > 2000) {
      setError('输出宽度和高度不能超过 2000 mm。');
      return;
    }
    const fileError = await validatePdfFile(selectedFile);
    if (fileError) {
      setError(fileError);
      return;
    }
    onFileSelect(selectedFile, dimensions);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  return (
    <div className="w-full">
      <div
        onDragOver={event => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={event => { event.preventDefault(); setIsDragging(false); if (event.dataTransfer.files[0]) void validateAndSelect(event.dataTransfer.files[0]); }}
        onClick={openFilePicker}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFilePicker(); } }}
        role="button"
        tabIndex={0}
        aria-label="上传单页独立稿件 PDF"
        aria-describedby={error ? 'upload-error' : 'upload-help'}
        className={`flex h-[220px] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-[18px] border-2 border-dashed border-[rgba(191,108,73,0.4)] bg-[#f5efe6] px-4 text-center transition-all duration-state ease-gentle active:bg-secondary-subtle min-[768px]:h-[230px] min-[768px]:gap-4 min-[768px]:rounded-[22px] ${isDragging ? 'border-secondary bg-secondary-subtle' : 'hover:border-secondary'}`}
      >
        <input type="file" ref={fileInputRef} onChange={event => {
          const selected = event.target.files?.[0];
          // Clear the input before validating so that picking the SAME file again still
          // fires change. Browsers skip change when the value is unchanged, so without
          // this a user who hit a validation error and then re-picked the same PDF got
          // no response at all and could not get past the upload step.
          event.target.value = '';
          if (selected) void validateAndSelect(selected);
        }} accept="application/pdf,.pdf" className="hidden" />
        <img src="/assets/decorations/home-upload.svg" alt="" aria-hidden="true" className="h-12 w-12 min-[768px]:h-[54px] min-[768px]:w-[54px]" />
        <p className="text-[17px] font-semibold leading-7 text-[#303225] min-[768px]:text-[20px] min-[768px]:leading-[30px]"><span className="min-[768px]:hidden">点击选择 PDF 文件</span><span className="hidden min-[768px]:inline">点击上传或拖拽 PDF 文件到这里</span></p>
        <p id="upload-help" className="text-[14px] font-normal leading-[18px] text-[#303225]/65">仅支持PDF格式 · 最大 200 MB</p>
      </div>

      {error && <p id="upload-error" role="alert" className="mt-3 rounded-md border border-error-border bg-error-bg px-4 py-3 text-sm font-semibold text-error-text">{error}</p>}
    </div>
  );
};
