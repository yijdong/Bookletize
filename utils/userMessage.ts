/**
 * pdf-lib 和 pdf.js 抛出的都是写给开发者看的英文错误。用户遇到时正卡在上传或导出
 * 这一步，手机上也没有控制台可看，所以这里换成一句能告诉他"接下来怎么办"的中文。
 * 原始报错仍然由各调用处的 console.error 记录下来，诊断信息没有丢。
 */
const KNOWN_ERRORS: ReadonlyArray<readonly [RegExp, string]> = [
  // pdf-lib：页面缺少 /Contents 流，通常是空页或半损坏的页。
  [/missing Contents/i, '这个 PDF 里有页面是空的或已损坏，没法拼版。请换一个文件，或先用其他工具修复后再试。'],
  // pdf-lib / pdf.js：文件被加密。
  [/encrypted|password/i, '这个 PDF 有密码保护。请先去掉密码，再重新上传。'],
  // 字节层面就读不出来。
  [
    /No PDF header found|Failed to parse PDF document|Invalid PDF structure|Invalid PDF binary data|Failed to parse PDF object|Failed to parse PDF stream|Parser stalled/i,
    '这个 PDF 已经损坏或不完整，没法读取。请重新导出后再试。',
  ],
  // 文件能解析，但页结构自相矛盾。
  [/corrupt page tree|Missing catalog/i, '这个 PDF 的页结构已损坏，没法读取。请重新导出后再试。'],
  // PDF 内嵌的图片有问题。
  [
    /Invalid JPEG|SOI not found in JPEG|Unknown JPEG channel|Unknown color type|Animated PNGs are not supported|stream encoding not supported|UnsupportedEncoding/i,
    '这个 PDF 里有图片无法解析（可能已损坏，或用了不支持的颜色格式）。请重新导出后再试。',
  ],
  // PDF 内部压缩流出错。
  [/flate stream|Unknown compression method/i, '这个 PDF 内部数据已损坏，没法读取。请重新导出后再试。'],
  // 内存不够——大文件或页数过多时会出现。
  [/out of memory|Array buffer allocation failed|Maximum call stack/i, '这个 PDF 太大或页数太多，内存不够。请减少页数或压缩后再试。'],
];

/**
 * 把抛出的异常转成一句可以给中文用户看的话。
 * 认不出来的错误一律用调用处自己的兜底文案，不把英文原文泄漏到界面上。
 */
export const toUserMessage = (reason: unknown, fallback: string): string => {
  const raw = reason instanceof Error ? reason.message : '';
  if (!raw) return fallback;
  for (const [pattern, message] of KNOWN_ERRORS) if (pattern.test(raw)) return message;
  return fallback;
};
