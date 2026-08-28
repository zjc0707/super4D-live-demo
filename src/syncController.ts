import type { ClockSnapshot, FakeMediaClock } from "./clock";
import { isSyncMessage, SYNC_CHANNEL, SYNC_VERSION, type SyncMessage, type SyncMode, type ViewerStatus } from "./protocol";

type Listener = () => void;

export class MediaSyncController {
  private sequence = 0;
  private lastViewerSequence = -1;
  private timer: number | null = null;
  private iframeLoaded = false;
  private readonly listeners = new Set<Listener>();
  private status: ViewerStatus = { ready: false, loading: false, currentTime: null, duration: null, lastMessage: "等待 Viewer iframe 加载", error: null, lastSequence: -1 };

  constructor(private readonly iframe: HTMLIFrameElement, private readonly viewerOrigin: string, private readonly mode: SyncMode, private readonly sessionId: string, private readonly clock: FakeMediaClock) {}

  private emit() { this.listeners.forEach((listener) => listener()); }

  private send(type: SyncMessage["type"], snapshot = this.clock.getSnapshot()) {
    if (!this.iframeLoaded) return;
    this.iframe.contentWindow?.postMessage({ channel: SYNC_CHANNEL, version: SYNC_VERSION, sessionId: this.sessionId, sequence: ++this.sequence, mode: this.mode, type, payload: { mediaTime: snapshot.currentTime, sentAt: Date.now(), playing: snapshot.playing, playbackRate: snapshot.playbackRate, duration: snapshot.duration } }, this.viewerOrigin);
  }

  private onLoad = () => { this.iframeLoaded = true; this.status = { ...this.status, lastMessage: "iframe 已加载，发送 INIT" }; this.emit(); this.send("INIT"); };

  private onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== this.iframe.contentWindow || event.origin !== this.viewerOrigin || !isSyncMessage(event.data)) return;
    const message = event.data;
    if (message.sessionId !== this.sessionId || message.mode !== this.mode || message.sequence <= this.lastViewerSequence) return;
    this.lastViewerSequence = message.sequence;
    const payload = message.payload || {};
    this.status = { ...this.status, ready: this.status.ready || message.type === "SYNC_READY", loading: message.type === "LOADING" || payload.loading === true, currentTime: typeof payload.currentTime === "number" ? payload.currentTime : this.status.currentTime, duration: typeof payload.duration === "number" ? payload.duration : this.status.duration, error: message.type === "ERROR" ? String(payload.error || "Viewer error") : this.status.error, lastMessage: message.type, lastSequence: message.sequence };
    this.emit();
    // The initial INIT can arrive while the Viewer is still constructing its
    // timeline.  Re-send the current anchor once it confirms readiness so a
    // late-join/end-of-live position is applied after the runtime is usable.
    if (message.type === "SYNC_READY") this.send("SYNC_STATE");
  };

  start = () => {
    this.iframe.addEventListener("load", this.onLoad);
    window.addEventListener("message", this.onMessage);
    this.timer = window.setInterval(() => this.send("SYNC_STATE"), 400);
  };

  stop = () => { this.iframe.removeEventListener("load", this.onLoad); window.removeEventListener("message", this.onMessage); if (this.timer !== null) window.clearInterval(this.timer); this.timer = null; this.listeners.clear(); };
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getStatus = () => this.status;
  sendPlaybackState = (snapshot: ClockSnapshot) => this.send(snapshot.playing ? "PLAY" : "PAUSE", snapshot);
  sendRateChange = (snapshot: ClockSnapshot) => this.send("RATE_CHANGE", snapshot);
  sendSeekBegin = (snapshot: ClockSnapshot) => this.send("SEEK_BEGIN", snapshot);
  sendSeekCommit = (snapshot: ClockSnapshot) => this.send("SEEK_COMMIT", snapshot);
  sendEnd = (snapshot: ClockSnapshot) => this.send("END", snapshot);
}
