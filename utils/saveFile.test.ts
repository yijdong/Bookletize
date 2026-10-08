import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMobileSaveBrowser, savePdfOnMobile } from './saveFile';

afterEach(() => vi.unstubAllGlobals());

describe('mobile PDF save', () => {
  const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  it('passes the actual PDF file to system share', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    expect(await savePdfOnMobile(pdf, 'book.pdf')).toBe('shared');
    const file = share.mock.calls[0][0].files[0];
    expect(file.name).toBe('book.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.7');
  });
  it('opens the PDF synchronously when file sharing is unsupported', async () => {
    const open = vi.fn().mockReturnValue({ opener: {} });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { open });
    const saving = savePdfOnMobile(pdf, 'book.pdf');
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), '_blank');
    expect(await saving).toBe('opened');
  });
  it('does not open a PDF when the user cancels sharing', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError')) });
    expect(await savePdfOnMobile(pdf, 'book.pdf')).toBe('cancelled');
  });
  it('allows the same button to bypass failed sharing on the next click', async () => {
    const share = vi.fn().mockRejectedValue(new Error('share failed'));
    vi.stubGlobal('navigator', { canShare: () => true, share });
    vi.stubGlobal('window', { open: vi.fn().mockReturnValue({}) });
    await expect(savePdfOnMobile(pdf, 'book.pdf')).rejects.toThrow('share failed');
    expect(await savePdfOnMobile(pdf, 'book.pdf', true)).toBe('opened');
    expect(share).toHaveBeenCalledTimes(1);
  });
  it('opens in the same tab when the browser blocks a new tab', async () => {
    const assign = vi.fn();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { open: () => null, location: { assign } });
    await savePdfOnMobile(pdf, 'book.pdf');
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
  });
  it.each([
    ['iPhone', 0, true], ['Android', 0, true], ['Macintosh', 5, true], ['Macintosh', 0, false], ['Windows', 0, false],
  ])('detects %s with %s touch points', (userAgent, maxTouchPoints, expected) => {
    vi.stubGlobal('navigator', { userAgent, maxTouchPoints });
    expect(isMobileSaveBrowser()).toBe(expected);
  });
});
