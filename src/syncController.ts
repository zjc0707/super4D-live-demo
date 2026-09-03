import type { ClockSnapshot, FakeMediaClock } from "./clock";
import { isViewerMessage, SYNC_CHANNEL, SYNC_VERSION, type PerformanceInfo, type SubtitleState, type SyncMessage, type SyncMode, type ViewerStatus } from "./protocol";

type Listener = () => void;

export class MediaSyncController {
  private sequence = 0;
  private lastViewerSequence = -1;
  private timer: number | null = null;
  private iframeLoaded = false;
  private viewerResponded = false;
  private seeking = false;
  private lastSyncStateSentAt = 0;
  private readonly listeners = new Set<Listener>();
  private readonly normalizedViewerOrigin: string;
  private status: ViewerStatus = { ready: false, loading: false, currentTime: null, duration: null, lastMessage: "等待 Viewer iframe 加载", error: null, lastSequence: -1, subtitle: { tracks: [], selectedTrackId: "", visible: true, maskVisible: false, fontScale: 1, verticalOffset: 0, error: null }, performance: null };

  constructor(private readonly iframe: HTMLIFrameElement, viewerOrigin: string, private readonly mode: SyncMode, private readonly sessionId: string, private readonly clock: FakeMediaClock, private readonly syncLogEnabled = false) {
    const parsed = new URL(viewerOrigin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`不支持的 Viewer origin: ${viewerOrigin}`);
    this.normalizedViewerOrigin = parsed.origin;
  }

  private log(event: string, payload: Record<string, unknown> = {}) {
    if (!this.syncLogEnabled) return;
    console.log(`[SUPER4D_SYNC][DEMO] ${event}`, JSON.stringify(payload));
  }

  private emit() { this.listeners.forEach((listener) => listener()); }

  private send(type: SyncMessage["type"], snapshot = this.clock.getSnapshot(), extra: Record<string, unknown> = {}) {
    if (!this.iframeLoaded) return;
    if (type === "SYNC_STATE") {
      const now = Date.now();
      if (now - this.lastSyncStateSentAt < 100) return;
      this.lastSyncStateSentAt = now;
    }
    const sequence = ++this.sequence;
    const payload = { mediaTime: snapshot.currentTime, sentAt: Date.now(), playing: snapshot.playing, playbackRate: snapshot.playbackRate, duration: snapshot.duration, ...extra };
    this.log("send", { type, sequence, mode: this.mode, ...payload, clockTime: snapshot.currentTime, clockPlaying: snapshot.playing });
    this.iframe.contentWindow?.postMessage({ channel: SYNC_CHANNEL, version: SYNC_VERSION, sessionId: this.sessionId, sequence, mode: this.mode, type, payload }, this.normalizedViewerOrigin);
  }

  private onLoad = () => {
    this.iframeLoaded = true;
    this.lastViewerSequence = -1;
    this.viewerResponded = false;
    this.lastSyncStateSentAt = 0;
    this.status = { ...this.status, ready: false, loading: false, currentTime: null, duration: null, lastMessage: "iframe 已重新加载，发送 INIT", error: null, lastSequence: -1, performance: null };
    this.log("iframe-load", { mode: this.mode, sessionId: this.sessionId, viewerOrigin: this.normalizedViewerOrigin, clockTime: this.clock.getSnapshot().currentTime });
    this.status = { ...this.status, lastMessage: "iframe 已加载，发送 INIT" };
    this.emit();
    this.send("INIT");
  };

  private onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== this.iframe.contentWindow || event.origin !== this.normalizedViewerOrigin || !isViewerMessage(event.data)) return;
    const message = event.data;
    if (message.sessionId !== this.sessionId || message.mode !== this.mode || message.sequence <= this.lastViewerSequence) return;
    this.viewerResponded = true;
    this.lastViewerSequence = message.sequence;
    const payload = message.payload || {};
    if (message.type === "SYNC_READY" && typeof payload.duration === "number" && Number.isFinite(payload.duration) && payload.duration > 0) this.clock.setDuration(payload.duration);
    if (message.type !== "VIEWER_STATE" && message.type !== "SUBTITLE_STATE") {
      this.log("receive", {
        type: message.type,
        sequence: message.sequence,
        mode: message.mode,
        viewerTime: payload.currentTime,
        viewerDuration: payload.duration,
        viewerLoading: payload.loading,
        ...payload,
        clockTime: this.clock.getSnapshot().currentTime,
        clockPlaying: this.clock.getSnapshot().playing,
      });
    }
    const wasLoading = this.status.loading;
    const loading = message.type === "LOADING"
      ? true
      : typeof payload.loading === "boolean"
        ? payload.loading
        : this.status.loading;
    const subtitle = payload.subtitle && Array.isArray(payload.subtitle.tracks) && typeof payload.subtitle.selectedTrackId === "string" ? payload.subtitle : this.status.subtitle;
    const performance = payload.performance && typeof payload.performance.renderFPS === "number" ? payload.performance as PerformanceInfo : this.status.performance;
    this.status = { ...this.status, ready: this.status.ready || message.type === "SYNC_READY", loading, currentTime: typeof payload.currentTime === "number" ? payload.currentTime : this.status.currentTime, duration: message.type === "SYNC_READY" && typeof payload.duration === "number" ? payload.duration : this.status.duration, error: message.type === "ERROR" ? String(payload.error || "Viewer error") : this.status.error, lastMessage: message.type, lastSequence: message.sequence, subtitle, performance };
    this.emit();
    // The initial INIT can arrive while the Viewer is still constructing its
    // timeline.  Re-send the current anchor once it confirms readiness so a
    // late-join/end-of-live position is applied after the runtime is usable.
    if (!this.seeking && (message.type === "SYNC_READY" || (wasLoading && !this.status.loading))) this.send("SYNC_STATE");
  };

  start = () => {
    this.iframe.addEventListener("load", this.onLoad);
    window.addEventListener("message", this.onMessage);
    // The controller is mounted before the iframe starts loading. The load
    // event is the single handshake trigger; INIT is never sent speculatively
    // before the Viewer document has installed its message listener.
    this.timer = window.setInterval(() => {
      if (this.viewerResponded && this.clock.getSnapshot().playing && !this.status.loading && !this.seeking) {
        this.send("SYNC_STATE");
      }
    }, 400);
  };

  stop = () => { this.iframe.removeEventListener("load", this.onLoad); window.removeEventListener("message", this.onMessage); if (this.timer !== null) window.clearInterval(this.timer); this.timer = null; this.listeners.clear(); };
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getStatus = () => this.status;
  sendPlaybackState = (snapshot: ClockSnapshot) => this.send(snapshot.playing ? "PLAY" : "PAUSE", snapshot);
  sendRateChange = (snapshot: ClockSnapshot) => this.send("RATE_CHANGE", snapshot);
  sendSeekBegin = (snapshot: ClockSnapshot) => this.send("SEEK_BEGIN", snapshot);
  sendSeekCommit = (snapshot: ClockSnapshot) => this.send("SEEK_COMMIT", snapshot);
  setSeeking = (seeking: boolean) => { this.seeking = seeking; };
  sendEnd = (snapshot: ClockSnapshot) => this.send("END", snapshot);
  sendSubtitleTrack = (trackId: string) => this.send("SUBTITLE_SET_TRACK", this.clock.getSnapshot(), { trackId });
  sendSubtitleVisible = (visible: boolean) => this.send("SUBTITLE_SET_VISIBLE", this.clock.getSnapshot(), { visible });
  sendSubtitleMask = (maskVisible: boolean) => this.send("SUBTITLE_SET_MASK", this.clock.getSnapshot(), { maskVisible });
  sendSubtitleFontScale = (fontScale: number) => this.send("SUBTITLE_SET_FONT_SCALE", this.clock.getSnapshot(), { fontScale });
  sendSubtitleOffset = (verticalOffset: number) => this.send("SUBTITLE_SET_OFFSET", this.clock.getSnapshot(), { verticalOffset });
}
