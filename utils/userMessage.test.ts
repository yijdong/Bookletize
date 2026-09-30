import { describe, expect, it } from 'vitest';
import { toUserMessage } from './userMessage';

describe('toUserMessage', () => {
  // The real message pdf-lib throws for an empty or half-broken page — the one users saw.
  it('把 pdf-lib 缺少 Contents 的英文换成中文', () => {
    const msg = toUserMessage(new Error("Can't embed page with missing Contents"), '兜底');
    expect(msg).not.toContain('missing Contents');
    expect(msg).toContain('已损坏');
  });

  it('把加密错误换成中文', () => {
    expect(toUserMessage(new Error('EncryptedPDFError'), '兜底')).toContain('密码');
  });

  it('把损坏文件的多种说法都归到同一句', () => {
    for (const raw of ['No PDF header found', 'Failed to parse PDF document', 'Invalid PDF structure']) {
      expect(toUserMessage(new Error(raw), '兜底')).toContain('损坏');
    }
  });

  it('认不出来的错误用调用处的兜底文案，不泄漏英文', () => {
    expect(toUserMessage(new Error('some brand new library failure'), '无法处理这个 PDF。')).toBe('无法处理这个 PDF。');
  });

  it('非 Error 的抛出值也走兜底', () => {
    expect(toUserMessage(undefined, '兜底')).toBe('兜底');
    expect(toUserMessage('a string throw', '兜底')).toBe('兜底');
    expect(toUserMessage(new Error(''), '兜底')).toBe('兜底');
  });
});
