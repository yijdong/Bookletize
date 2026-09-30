import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PDFJS_ROOT = path.resolve(__dirname, 'node_modules/pdfjs-dist');

/**
 * pdf.js 5 在**运行时**按固定文件名去取这些辅助资源（内部是 `${wasmUrl}openjpeg.wasm`
 * 这种字符串拼接），所以它们必须以原始文件名发布——Vite 的 `?url` 会给文件名加哈希，
 * 拼出来的路径就对不上了。
 *
 * 缺了它们，pdf.js 解不了 JBIG2 / JPEG2000 / ICC 色彩空间的图片，而且**不报错**：
 * 只打一句 warn，然后把那张图静默跳过，用户看到的是一页空白。中文 PDF 还依赖 cmaps
 * 才能显示 CID 字体的文字，缺了同样是一片空白。
 */
const PDFJS_ASSET_DIRS = ['wasm', 'iccs', 'cmaps', 'standard_fonts'];

const pdfjsAssets = (): Plugin => ({
  name: 'pdfjs-assets',

  // dev：直接从 node_modules 里读，省掉「忘了拷」这类问题。
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || '').split('?')[0];
      const match = url.match(/^\/(wasm|iccs|cmaps|standard_fonts)\/([^/]+)$/);
      if (!match) return next();
      // basename 挡掉 ../ 之类的路径穿越。
      const file = path.join(PDFJS_ROOT, match[1], path.basename(match[2]));
      fs.readFile(file, (err, data) => {
        if (err) return next();
        res.setHeader('Content-Type', match[1] === 'wasm' ? 'application/wasm' : 'application/octet-stream');
        res.end(data);
      });
    });
  },

  // build：原样带进 dist，始终跟随已安装的 pdfjs 版本。
  generateBundle() {
    for (const dir of PDFJS_ASSET_DIRS) {
      const full = path.join(PDFJS_ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const name of fs.readdirSync(full)) {
        this.emitFile({ type: 'asset', fileName: `${dir}/${name}`, source: fs.readFileSync(path.join(full, name)) });
      }
    }
  },
});

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), pdfjsAssets()],
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('pdfjs-dist')) return 'pdfjs';
              if (id.includes('pdf-lib')) return 'pdf-lib';
              if (id.includes('jszip')) return 'jszip';
              if (id.includes('react')) return 'react';
            },
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
