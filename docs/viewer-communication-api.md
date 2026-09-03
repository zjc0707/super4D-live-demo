# Demo 与 Viewer iframe 通信接口

本文档记录 `super4D-live-demo` 与 `super4D-viewer` 之间的 iframe 通信协议。
主协议使用浏览器的 `window.postMessage`，协议名称为 `SUPER4D_MEDIA_SYNC`，同时适用于直播和录播。

## 1. 启用外部同步

Demo 通过以下 URL 参数加载 Viewer：

```text
sync=live|replay
parent_origin=http://localhost:5182
session_id=<本次页面会话 ID>
noui=1
test_start_time=<初始媒体时间，秒>
```

其中：

- `sync=live`：启用直播外部时钟模式。
- `sync=replay`：启用录播外部时钟模式。
- `parent_origin`：Viewer 允许接收消息的父页面 origin。
- `session_id`：绑定一次 Demo 页面和 Viewer iframe 会话。
- `noui=1`：隐藏 Viewer 自带播放控制，控制权交给 Demo。
- `test_start_time`：首次加载时选择正确的资源分段和初始时间，主要用于晚加入直播。
- `sync_log=1`：可选，仅开启 Demo/Viewer 的 `[SUPER4D_SYNC]` 调试日志，不改变通信行为。

Demo 当前 URL 组装位置：`src/App.tsx` 的 `viewerUrl`。

## 2. 统一消息格式

所有正式同步消息都使用以下封装：

```ts
type SyncMessage = {
  channel: "SUPER4D_MEDIA_SYNC";
  version: 1;
  sessionId: string;
  sequence: number;
  mode: "live" | "replay";
  type: string;
  payload?: object;
};
```

字段约定：

- `channel`：固定为 `SUPER4D_MEDIA_SYNC`。
- `version`：当前协议版本为 `1`。
- `sessionId`：由 Demo 生成，双方必须完全一致。
- `sequence`：消息发送方单调递增的序号；接收方丢弃旧序号。
- `mode`：必须与当前页面的 `live` 或 `replay` 一致。
- `type`：具体接口名称。
- `payload`：接口参数或状态数据。

定义位置：`src/protocol.ts` 和 Viewer 的 `src/controllers/sync/externalTimeSyncController.ts`。

## 3. Demo → Viewer

Demo 的 `MediaSyncController` 负责发送以下消息。

### 3.1 播放状态与时钟

这些消息的常用 `payload` 字段如下：

```ts
type ClockPayload = {
  mediaTime: number;      // 主页面媒体时间，秒
  sentAt: number;         // 发送时的 Date.now()，毫秒
  playing: boolean;       // 是否播放
  playbackRate: number;   // 播放倍速
  duration: number;       // 主页面媒体总时长，秒
};
```

| type | 作用 | 发送时机 |
| --- | --- | --- |
| `INIT` | 初始化 Viewer 的时间、播放状态和倍速 | iframe `load` 事件触发后发送一次 |
| `SYNC_STATE` | 发送时钟锚点，供 Viewer 预测和校正时间 | 播放中约每 400ms 一次；Viewer ready/loading 状态变化后也可能立即补发 |
| `PLAY` | 开始播放 | Demo 播放按钮从暂停切换到播放时 |
| `PAUSE` | 暂停播放 | Demo 播放按钮从播放切换到暂停时 |
| `RATE_CHANGE` | 修改播放倍速 | 录播页面改变倍速时；直播页面不提供倍速按钮 |
| `END` | 结束播放并停止 Viewer | 直播时钟达到总时长时 |

直播暂停后 Demo 不再发送周期性 `SYNC_STATE`；恢复直播时会按当前墙上时间重新定位，再发送播放命令。

### 3.2 录播 seek

录播进度条属于 Demo 主页面，Viewer 自带进度条隐藏。

| type | 作用 | 主要 payload | 发送时机 |
| --- | --- | --- | --- |
| `SEEK_BEGIN` | 开始拖动；先暂停 Viewer，阻止旧排序结果继续显示 | `ClockPayload` | 指针按下 |
| `SEEK_COMMIT` | 提交拖动后的目标时间；Viewer 执行原生 seek 并等待目标排序完成 | `ClockPayload` | 指针松开，仅一次 |

拖动过程中只更新 Demo 时钟预览，不连续向 Viewer 发送 seek。
`SEEK_COMMIT.payload.playing` 表示 seek 前是否处于播放状态，Viewer 据此决定 seek 完成后是否恢复播放。

### 3.3 字幕控制

| type | payload | 作用 |
| --- | --- | --- |
| `SUBTITLE_SET_TRACK` | `{ trackId: string }` | 切换字幕轨道 |
| `SUBTITLE_SET_VISIBLE` | `{ visible: boolean }` | 显示或隐藏字幕 |
| `SUBTITLE_SET_MASK` | `{ maskVisible: boolean }` | 开关文字描边/遮罩 |
| `SUBTITLE_SET_FONT_SCALE` | `{ fontScale: number }` | 设置字号比例，Demo 使用 `0.5`–`2` |
| `SUBTITLE_SET_OFFSET` | `{ verticalOffset: number }` | 设置垂直位置，Demo 使用 `0`–`30` |

字幕命令在直播和录播模式都可用。Viewer 会异步处理轨道切换，并通过 `SUBTITLE_STATE` 返回最终状态；切换失败则返回 `ERROR`。

## 4. Viewer → Demo

Viewer 外部同步 bridge 通过 `post` 函数向父页面发送以下消息。

### 4.1 生命周期、时间和加载状态

| type | 主要 payload | 作用 |
| --- | --- | --- |
| `SYNC_READY` | `{ duration, currentTime, subtitle }` | Viewer 运行时和可渲染画布准备完成；`duration` 可用于校准 Demo 时钟 |
| `VIEWER_TIME` | `{ currentTime, duration, loading }` | 返回 Viewer 当前时间；用于 Demo 诊断面板 |
| `VIEWER_STATE` | `{ currentTime, duration, loading }` | 返回 Viewer 当前稳定状态；暂停且无 pending seek 时不会持续产生周期上报 |
| `LOADING` | `{ currentTime, duration, loading: true }` | Viewer 正在加载资源/分段或等待渲染条件 |
| `ERROR` | `{ error, loading }` | Viewer 运行时、资源或字幕操作出错 |
| `ENDED` | `{ currentTime }` | Viewer 收到 `END` 后确认结束 |

Viewer 会在首次 ready、加载状态变化、seek 状态变化等时机上报状态。播放期间的时间推进主要由 Viewer 本地播放循环完成，Demo 通过约 400ms 的时钟锚点校正，而不是逐帧 postMessage。

### 4.2 字幕状态

`SUBTITLE_STATE` 的 payload 结构：

```ts
type SubtitleState = {
  tracks: Array<{
    id: string;
    language: string;
    label: string;
  }>;
  selectedTrackId: string;
  visible: boolean;
  maskVisible: boolean;
  fontScale: number;
  verticalOffset: number;
  error: string | null;
};
```

Viewer 会在 ready、字幕设置变更和字幕轨道切换完成后返回该状态。没有可用字幕轨道时，Demo 不显示字幕控制面板。

### 4.3 性能信息

`PERFORMANCE_INFO` 的 payload 为：

```ts
type PerformanceInfo = {
  renderFPS: number;
  sortingFPS: number;
  sortTimeConsuming: number;
  sortTimeOffset: number;
  renderCount: number;
  drawCalls: number;
  sortingEngine: string;
  renderEngine: string;
};
```

字段含义：

- `renderFPS`：渲染帧率。
- `sortingFPS`：排序帧率。
- `sortTimeConsuming`：单次排序耗时，毫秒。
- `sortTimeOffset`：排序时间相对当前媒体时间的偏移，毫秒。
- `renderCount`：当前渲染的 splat 数量。
- `drawCalls`：当前 draw call 数量。
- `sortingEngine` / `renderEngine`：排序和渲染引擎名称。

Demo 将最近一条性能信息显示在同步诊断面板中。

## 5. 消息校验与来源绑定

### Demo 接收 Viewer 消息

Demo 只接受同时满足以下条件的消息：

1. `event.source === iframe.contentWindow`。
2. `event.origin === VITE_VIEWER_ORIGIN` 的 origin。
3. 通过 `isViewerMessage` 校验，`channel/version/type/payload` 合法。
4. `sessionId` 和 `mode` 与当前 Demo 会话一致。
5. `sequence` 大于上一次接收的 Viewer 序号。

### Viewer 接收 Demo 消息

Viewer 只接受同时满足以下条件的消息：

1. `event.source === window.parent`。
2. `event.origin === parent_origin` 解析后的 origin。
3. 通过 Viewer bridge 的消息结构和数值校验。
4. `sessionId` 和 `mode` 与 URL 配置一致。
5. `sequence` 大于上一次接收的 Demo 序号。

不满足条件的消息直接丢弃，不改变播放状态。

## 6. 典型时序

### 6.1 直播

```text
iframe load
  → Demo: INIT
  → Viewer: LOADING / SYNC_READY
  → Demo: SYNC_STATE（ready 后补发当前锚点）
  → Viewer: 首帧加载、目标分段排序、VIEWER_TIME / VIEWER_STATE
  → 播放中：Demo 每约 400ms 发 SYNC_STATE，Viewer 平滑校正
  → 直播结束：Demo 发 END，暂停时钟并卸载 iframe
```

如果用户晚于直播开始时间进入，Demo 在 `INIT` 中携带已经过去的 `mediaTime`，同时通过 `test_start_time` 让 Viewer 首次加载正确分段。

### 6.2 录播

```text
iframe load
  → Demo: INIT
  → Viewer: SYNC_READY
  → Demo: SYNC_STATE / PLAY
  → 用户按下主页面进度条：Demo: SEEK_BEGIN
  → 拖动中：只更新 Demo 预览时间
  → 用户松开：Demo: SEEK_COMMIT
  → Viewer：暂停、原生 seek、等待目标 sort 完成
  → Viewer：按 payload.playing 恢复或保持暂停
```

## 7. Demo 当前使用的接口实现位置

- 协议类型、消息白名单和基础校验：`src/protocol.ts`
- Demo iframe 握手、发送和接收：`src/syncController.ts`
- Demo URL 组装、直播/录播控件和字幕面板：`src/App.tsx`
- Viewer 外部同步 bridge：`super4D-viewer/src/controllers/sync/externalTimeSyncController.ts`
- Viewer sort/render 同步诊断日志：`super4D-viewer/src/viewer.ts`
