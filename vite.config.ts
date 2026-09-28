import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
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
