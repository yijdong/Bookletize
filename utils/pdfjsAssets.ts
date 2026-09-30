/**
 * pdf.js 5 的解码器和字体/色彩资源不在主包里，运行时才按需去取。这些地址由调用方提供，
 * 而且 pdf.js 内部是**字符串直接拼接**（`${wasmUrl}openjpeg.wasm`），所以每个路径末尾
 * 必须带斜杠，少一个就会拼出 `/wasmopenjpeg.wasm` 这种取不到的地址。
 *
 * 不传的后果不是报错，是**静默画不出来**：
 *   - wasmUrl  → JBIG2、JPEG2000 图片，以及 ICC 色彩空间，整张图被跳过，页面一片空白
 *   - iccUrl   → 印刷流程常见的 CMYK 稿颜色或内容异常
 *   - cMapUrl  → 用 CID 字体的中文 PDF，文字整段消失
 *
 * 这几个目录由 vite.config.ts 里的 pdfjs-assets 插件按原文件名发布。
 */
const base = import.meta.env.BASE_URL;   // 默认 '/'，且一定以斜杠结尾

export const PDFJS_ASSET_OPTIONS = {
  wasmUrl: `${base}wasm/`,
  iccUrl: `${base}iccs/`,
  cMapUrl: `${base}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${base}standard_fonts/`,
} as const;
