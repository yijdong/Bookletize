import { describe, expect, it } from 'vitest';
import { PDFJS_ASSET_OPTIONS } from './pdfjsAssets';

describe('PDFJS_ASSET_OPTIONS', () => {
  // pdf.js 内部是 `${wasmUrl}openjpeg.wasm` 这种字符串拼接，漏了斜杠会拼出
  // `/wasmopenjpeg.wasm`，而失败方式是不报错、直接把图片跳过。
  it.each(['wasmUrl', 'iccUrl', 'cMapUrl', 'standardFontDataUrl'] as const)(
    '%s 以斜杠结尾（pdf.js 靠字符串拼接取文件）',
    key => { expect(PDFJS_ASSET_OPTIONS[key]).toMatch(/\/$/); },
  );

  it('指向的是构建插件发布的那几个目录', () => {
    expect(PDFJS_ASSET_OPTIONS.wasmUrl).toMatch(/\/wasm\/$/);
    expect(PDFJS_ASSET_OPTIONS.cMapUrl).toMatch(/\/cmaps\/$/);
    expect(PDFJS_ASSET_OPTIONS.iccUrl).toMatch(/\/iccs\/$/);
    expect(PDFJS_ASSET_OPTIONS.standardFontDataUrl).toMatch(/\/standard_fonts\/$/);
  });

  it('cmaps 是打包格式，否则 pdf.js 会去取未打包的同名文件', () => {
    expect(PDFJS_ASSET_OPTIONS.cMapPacked).toBe(true);
  });
});
