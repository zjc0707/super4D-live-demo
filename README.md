# super4D live demo

用于验证外部页面与 `super4D-viewer` iframe 的时间线通信。

## 启动

先启动 Viewer（当前 worktree）：

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

同步调试日志默认关闭。在 URL 中增加 `sync_log=1`（例如
`/live?live_start=17:00&sync_log=1` 或 `/replay?sync_log=1`）后，Demo 和
iframe Viewer 才会输出 `[SUPER4D_SYNC]` 日志。该参数只控制日志，不影响同步通信。

Viewer 使用 `/viewer/timtalk_test_1h` 线上资源。`VITE_VIEWER_ORIGIN` 可在 `.env` 中修改。Replay 的唯一可操作进度条位于 Demo 主页面；iframe 内 Viewer 使用 `noui=1` 隐藏自身播放控制。

## 字幕 iframe 接口

当 Viewer 使用 `sync=live` 或 `sync=replay` 加载时，父页面可在既有
`SUPER4D_MEDIA_SYNC` 消息中发送以下命令（`payload` 仍需携带当前时钟字段）：

- `SUBTITLE_SET_TRACK`：`{ trackId }`
- `SUBTITLE_SET_VISIBLE`：`{ visible }`
- `SUBTITLE_SET_MASK`：`{ maskVisible }`
- `SUBTITLE_SET_FONT_SCALE`：`{ fontScale }`（0.5–2）
- `SUBTITLE_SET_OFFSET`：`{ verticalOffset }`（0–30）

Viewer 会返回 `SUBTITLE_STATE`，其中包含轨道的 `id/language/label` 和当前字幕显示状态；字幕源 URL 不会通过 iframe 协议暴露。Demo 页面已经使用这组接口提供字幕控制面板。

## 性能信息接口

Viewer 会周期性返回 `PERFORMANCE_INFO`，消息结构仍遵循
`SUPER4D_MEDIA_SYNC` 的 `channel/version/sessionId/sequence/mode/type/payload`
封装。`payload.performance` 包含：

- `renderFPS`：渲染帧率
- `sortingFPS`：排序帧率
- `sortTimeConsuming`：单次排序耗时，单位毫秒
- `sortTimeOffset`：排序时间相对当前媒体时间的偏移，单位毫秒
- `renderCount`：当前渲染的 splat 数量
- `drawCalls`：当前 draw call 数量
- `sortingEngine`、`renderEngine`：当前排序和渲染引擎

Demo 的同步诊断面板会展示最近一次 `PERFORMANCE_INFO` 数据。
