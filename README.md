# super4D live demo

用于验证外部页面与 `super4D-viewer` iframe 的时间线通信。

## 启动

先启动本地 `.4dv` 静态服务器（必须支持 CORS）：

```bash
npx http-server /Users/jcz/Downloads/timtalk-1h -p 5183 --cors
```

再启动 Viewer（当前 worktree）：

```bash
cd /Users/jcz/.codex/worktrees/e4b7/super4D-viewer
pnpm exec vite --port 5181
```

再启动 Demo：

```bash
cd /Users/jcz/WebstormProjects/super4D-live-demo
pnpm dev
```

打开 `http://localhost:5182/live?live_start=17:00` 或 `http://localhost:5182/replay`。

直播开始时间由 `/live` 的 `live_start=HH:mm` URL 参数控制，未提供时默认当天 17:00。

`VITE_VIEWER_ORIGIN` 和 `VITE_VIEWER_CONTENT_URL` 可在 `.env` 中改为其他地址。Replay 的唯一可操作进度条位于 Demo 主页面；iframe 内 Viewer 使用 `noui=1` 隐藏自身播放控制。
