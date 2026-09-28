# 绘本排版助手

一个完全在浏览器本地运行的骑马钉 PDF 拼版工具。首页接收单页独立稿件；连页稿可以先在“连页稿拆成单页”中逐页选择是否从中间拆分。文件不会上传到网络。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

本项目不使用 Gemini 或任何 API Key。旧版生成的 `.env.local` 可以保留，也可以手动删除，它不会被构建读取。

## 检查与构建

```bash
npm run typecheck
npm test
npm run build
```

生产文件输出到 `dist/`，可部署到任意静态托管平台。应用使用 History API 以外的单页入口，因此无需额外配置路由回退。

## 当前限制

- 单个 PDF 最大 200 MB。
- 最多处理 240 个逻辑内容页。
- 输出整张纸的宽高范围为 10–2000 mm。
