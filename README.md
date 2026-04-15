# web-dictation-prototype

一个基于 Vite + React + TypeScript 的轻量级网页听写工具，支持：

- 浏览器本地语音识别
- ElevenLabs 实时转写
- ElevenLabs 批量语音转写
- OpenAI 兼容接口后处理
- PWA 安装
- GitHub Pages 静态部署

## 开源信息

- License: MIT
- 适合直接公开到 GitHub
- 默认不提交密钥，配置仅保存在浏览器 IndexedDB

## 工作方式

本项目是纯前端静态应用：

- 页面可部署到 GitHub Pages
- ElevenLabs 请求由浏览器直接发出
- LLM 后处理请求由浏览器直接发到你填写的 OpenAI 兼容接口
- 不依赖你自己的后端

## 本地开发

```bash
npm ci
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## GitHub Pages 自动部署

仓库已包含工作流：

- `.github/workflows/deploy-pages.yml`

### 首次启用

1. 将仓库推送到 GitHub。
2. 打开 **Settings -> Pages**。
3. 将 **Source** 设为 **GitHub Actions**。
4. 推送到 `main` 分支，或手动运行工作流。

### 说明

- 如果仓库地址是 `https://<user>.github.io/<repo>/`，构建时会自动处理 Vite `base`。
- 如果是自定义域名或用户根站点，则使用 `/`。
- 如有需要，可通过 `PAGES_BASE_PATH` 覆盖构建 base。

## 隐私说明

- ElevenLabs API Key 与 LLM API Key 仅保存在当前浏览器 IndexedDB。
- 本项目不会把这些密钥上传到你自己的远端后端。
- 但请求会直接从浏览器发往 ElevenLabs 或你填写的 LLM 接口。

## 技术栈

- Vite
- React
- TypeScript
- vite-plugin-pwa
- ElevenLabs React SDK
