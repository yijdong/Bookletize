export interface SaveFileType {
  description: string;
  accept: Record<string, string[]>;
}

export interface SaveFileHandle {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string; types?: SaveFileType[] }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

export async function requestSaveHandle(suggestedName: string, types?: SaveFileType[]): Promise<SaveFileHandle | null | undefined> {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!picker) return undefined;
  try {
    return await picker({ suggestedName, types });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') return null;
    console.warn('系统保存窗口不可用，已改用浏览器下载。', reason);
    return undefined;
  }
}

export async function saveBlobToHandleOrDownload(blob: Blob, suggestedName: string, handle?: SaveFileHandle) {
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function saveBlobWithPicker(blob: Blob, suggestedName: string, types?: SaveFileType[]) {
  const handle = await requestSaveHandle(suggestedName, types);
  if (handle === null) return;
  await saveBlobToHandleOrDownload(blob, suggestedName, handle);
}
