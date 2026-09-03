import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FakeMediaClock, type ClockSnapshot } from "./clock";
import { makeSessionId, type SubtitleState } from "./protocol";
import { MediaSyncController } from "./syncController";
import "./styles.css";

// const VIEWER_ORIGIN = import.meta.env.VITE_VIEWER_ORIGIN || "http://localhost:5173";
// const VIEWER_PATH = "/viewer/timtalk_test_1h";
const VIEWER_ORIGIN = 'https://www.4dv.ai'
const VIEWER_PATH = "/4dv-obs/timtalk_test_1h"
const REPLAY_DURATION = 60 * 60;
const LIVE_DURATION = 60 * 60;

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
};

const getLiveStartFromUrl = () => {
  const start = new Date();
  start.setHours(17, 0, 0, 0);
  const value = new URLSearchParams(window.location.search).get("live_start");
  const match = value?.match(/^(?:[01]?\d|2[0-3]):[0-5]\d$/);
  if (!match) return start;
  const [hours, minutes] = value!.split(":").map(Number);
  start.setHours(hours, minutes, 0, 0);
  return start;
};

const useClock = (clock: FakeMediaClock) => {
  const [snapshot, setSnapshot] = useState(clock.getSnapshot());
  useEffect(() => clock.subscribe(() => setSnapshot(clock.getSnapshot())), [clock]);
  return snapshot;
};

const defaultSubtitle: SubtitleState = { tracks: [], selectedTrackId: "", visible: true, maskVisible: false, fontScale: 1, verticalOffset: 0, error: null };
const defaultStatus: ReturnType<MediaSyncController["getStatus"]> = { ready: false, loading: false, currentTime: null, duration: null, lastMessage: "等待 iframe", error: null, lastSequence: -1, subtitle: defaultSubtitle, performance: null };

const SyncDiagnostics = ({ status, snapshot, sessionId }: { status: ReturnType<MediaSyncController["getStatus"]>; snapshot: ClockSnapshot; sessionId: string }) => {
  const error = status.currentTime === null ? null : snapshot.currentTime - status.currentTime;
  return <aside className="diagnostics">
    <h3>同步诊断</h3>
    <div>主页面时间：{formatTime(snapshot.currentTime)}</div>
    <div>Viewer 时间：{status.currentTime === null ? "--" : formatTime(status.currentTime)}</div>
    <div>误差：{error === null ? "--" : `${(error * 1000).toFixed(0)} ms`}</div>
    <div>Viewer：{status.ready ? "ready" : "等待中"} / {status.loading ? "loading" : "idle"}</div>
    <div>sequence：{status.lastSequence}</div>
    <div>最近消息：{status.lastMessage}</div>
    {status.performance ? <div>性能：渲染 {status.performance.renderFPS.toFixed(1)} FPS / 排序 {status.performance.sortingFPS.toFixed(1)} FPS / 排序耗时 {status.performance.sortTimeConsuming.toFixed(1)} ms / 偏移 {status.performance.sortTimeOffset.toFixed(1)} ms / draw calls {status.performance.drawCalls} / splats {status.performance.renderCount} / {status.performance.sortingEngine} / {status.performance.renderEngine}</div> : <div>性能：等待 Viewer 数据</div>}
    <div className="session">sessionId：{sessionId}</div>
    {status.error ? <div className="error">{status.error}</div> : null}
  </aside>;
};

const SubtitleControls = ({ subtitle, controller }: { subtitle: SubtitleState; controller: MediaSyncController | null }) => {
  if (subtitle.tracks.length === 0) return null;
  return <fieldset className="subtitle-controls">
    <legend>字幕</legend>
    <label>
      语言
      <select value={subtitle.selectedTrackId} onChange={(event) => controller?.sendSubtitleTrack(event.target.value)}>
        {subtitle.tracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
      </select>
    </label>
    <label className="check-control"><input type="checkbox" checked={subtitle.visible} onChange={(event) => controller?.sendSubtitleVisible(event.target.checked)} />显示字幕</label>
    <label className="check-control"><input type="checkbox" checked={subtitle.maskVisible} onChange={(event) => controller?.sendSubtitleMask(event.target.checked)} />文字描边</label>
    <label>字号 {Math.round(subtitle.fontScale * 100)}%
      <input type="range" min="50" max="200" step="10" value={Math.round(subtitle.fontScale * 100)} onChange={(event) => controller?.sendSubtitleFontScale(Number(event.target.value) / 100)} />
    </label>
    <label>位置上移 {subtitle.verticalOffset}%
      <input type="range" min="0" max="30" step="1" value={subtitle.verticalOffset} onChange={(event) => controller?.sendSubtitleOffset(Number(event.target.value))} />
    </label>
    {subtitle.error ? <div className="subtitle-error" role="alert">{subtitle.error}</div> : null}
  </fieldset>;
};

const DemoPage = ({ mode }: { mode: "live" | "replay" }) => {
  const sessionId = useMemo(makeSessionId, []);
  const syncLogEnabled = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("sync_log");
    return value === "1" || value === "true";
  }, []);
  const [scheduledStart, setScheduledStart] = useState(getLiveStartFromUrl);
  const [initialTime] = useState(() => mode === "live" ? Math.max(0, (Date.now() - scheduledStart.getTime()) / 1000) : 0);
  const [liveStarted, setLiveStarted] = useState(() => mode !== "live" || Date.now() >= scheduledStart.getTime());
  const clockRef = useRef<FakeMediaClock | null>(null);
  if (!clockRef.current) {
    clockRef.current = new FakeMediaClock(
      mode === "live" ? LIVE_DURATION : REPLAY_DURATION,
      initialTime,
      mode === "live" && liveStarted && initialTime < LIVE_DURATION,
    );
  }
  const clock = clockRef.current;
  const snapshot = useClock(clock);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewerWrapRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<MediaSyncController | null>(null);
  const [status, setStatus] = useState(defaultStatus);
  const [dragging, setDragging] = useState(false);
  const [viewerClosed, setViewerClosed] = useState(() => mode === "live" && initialTime >= LIVE_DURATION);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wasPlayingRef = useRef(false);
  const seekGestureRef = useRef(false);
  const endNotifiedRef = useRef(false);

  const viewerUrl = useMemo(() => {
    const url = new URL(`${VIEWER_ORIGIN}${VIEWER_PATH}`);
    url.searchParams.set("sync", mode);
    url.searchParams.set("parent_origin", window.location.origin);
    url.searchParams.set("session_id", sessionId);
    url.searchParams.set("noui", "1");
    if (syncLogEnabled) url.searchParams.set("sync_log", "1");
    // Embedded playback should show the first usable frame directly without
    // the Viewer intro shader transition.
    url.searchParams.set("test_first_frame_shader", "false");
    // The parent clock owns playback state; do not let Viewer auto-play
    // between the first frame and the first external SYNC_STATE.
    url.searchParams.set("test_auto_play_first", "false");
    // Bust cached Viewer documents after changing the URL-based ZIP loader.
    url.searchParams.set("sync_rev", "zip-source-v2");
    url.searchParams.set("test_start_time", String(Math.floor(initialTime)));
    return url.toString();
  }, [mode, sessionId, initialTime, syncLogEnabled]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const controller = new MediaSyncController(iframe, VIEWER_ORIGIN, mode, sessionId, clock, syncLogEnabled);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(() => setStatus(controller.getStatus()));
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
      controllerRef.current = null;
    };
  }, [clock, mode, sessionId, syncLogEnabled]);

  // The broadcast schedule is the authoritative live boundary. Viewer
  // duration may describe only a loaded segment while it is still buffering.
  const liveEnded = mode === "live"
    && status.duration !== null
    && snapshot.currentTime >= snapshot.duration;

  useEffect(() => {
    if (mode !== "live" || liveStarted) return;
    const delay = Math.max(0, scheduledStart.getTime() - Date.now());
    const timer = window.setTimeout(() => {
      setLiveStarted(true);
      clock.seek(0);
      clock.play();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [clock, liveStarted, mode, scheduledStart]);

  useEffect(() => {
    if (!liveEnded) {
      endNotifiedRef.current = false;
      // Keep an already-expired broadcast closed before the Viewer has sent
      // its duration. Re-open it only when the schedule is changed back into
      // the valid broadcast window.
      if (snapshot.currentTime < snapshot.duration) setViewerClosed(false);
      return;
    }
    if (endNotifiedRef.current) return;
    endNotifiedRef.current = true;
    controllerRef.current?.sendEnd(clock.getSnapshot());
    clock.pause();
    // Give END one turn to reach the Viewer, then unmount the iframe so its
    // canvas, workers and stream resources are released after the broadcast.
    setViewerClosed(true);
  }, [clock, liveEnded]);

  const togglePlay = () => {
    if (snapshot.playing) {
      clock.pause();
    } else if (mode === "live") {
      // Live playback resumes from the current broadcast position rather than
      // from the point where the viewer was paused.
      const liveTime = Math.max(0, (Date.now() - scheduledStart.getTime()) / 1000);
      clock.seek(Math.min(LIVE_DURATION, liveTime));
      if (liveTime < LIVE_DURATION) clock.play();
    } else {
      clock.play();
    }
    controllerRef.current?.sendPlaybackState(clock.getSnapshot());
  };

  const changeRate = () => {
    clock.setPlaybackRate(snapshot.playbackRate >= 2 ? 1 : snapshot.playbackRate + 0.5);
    controllerRef.current?.sendRateChange(clock.getSnapshot());
  };

  const beginSeek = () => {
    if (mode !== "replay") return;
    wasPlayingRef.current = snapshot.playing;
    clock.pause();
    setDragging(true);
    seekGestureRef.current = true;
    controllerRef.current?.setSeeking(true);
    controllerRef.current?.sendSeekBegin(clock.getSnapshot());
  };

  const commitSeek = (value: number) => {
    if (mode !== "replay") return;
    if (!seekGestureRef.current) return;
    seekGestureRef.current = false;
    clock.seek(value);
    setDragging(false);
    if (wasPlayingRef.current) clock.play();
    controllerRef.current?.sendSeekCommit(clock.getSnapshot());
    controllerRef.current?.setSeeking(false);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewerWrapRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const viewerWrap = viewerWrapRef.current;
    if (!viewerWrap) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await viewerWrap.requestFullscreen();
      }
    } catch (error) {
      console.warn("无法切换全屏模式", error);
    }
  };

  const scheduledValue = new Date(scheduledStart.getTime() - scheduledStart.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return <main className="page">
    <header>
      <div><span className="eyebrow">super4D</span><h1>{mode === "live" ? "直播时钟 Demo" : "录播回放 Demo"}</h1></div>
      <nav><a className={mode === "live" ? "active" : ""} href="/live">直播</a><a className={mode === "replay" ? "active" : ""} href="/replay">录播</a></nav>
    </header>
    <section className="stage">
      <div ref={viewerWrapRef} className="viewer-wrap">
        {liveEnded || viewerClosed ? <div className="viewer-closed" role="status">直播已结束</div> : !liveStarted && mode === "live" ? <div className="viewer-closed" role="status">直播尚未开始</div> : <iframe ref={iframeRef} title="super4D viewer" src={viewerUrl} allowFullScreen />}
      </div>
      <div className="controls">
        {mode === "live" ? <><label>直播开始时间 <input type="datetime-local" value={scheduledValue} onChange={(event) => { const next = new Date(event.target.value); const nextStarted = Date.now() >= next.getTime(); setScheduledStart(next); setLiveStarted(nextStarted); clock.seek(Math.max(0, (Date.now() - next.getTime()) / 1000)); if (nextStarted) clock.play(); else clock.pause(); }} /></label><p className="hint">当前使用线上 timtalk_test_1h 资源，直播时长按 1 小时模拟。</p></> : null}
        {liveEnded ? <div className="ended-banner" role="status">直播已结束</div> : null}
        {liveStarted || mode !== "live" ? <>
          {mode === "replay" ? <input aria-label="主页面录播进度条" type="range" min="0" max={snapshot.duration} step="0.01" value={snapshot.currentTime} onPointerDown={beginSeek} onChange={(event) => { if (dragging) clock.seek(Number(event.target.value)); }} onPointerUp={(event) => commitSeek(Number((event.target as HTMLInputElement).value))} /> : <div className="live-progress"><span style={{ width: `${Math.min(100, snapshot.currentTime / snapshot.duration * 100)}%` }} /></div>}
          <div className="button-row"><button onClick={togglePlay}>{snapshot.playing ? "暂停" : "播放"}</button>{mode === "replay" ? <button onClick={changeRate}>倍速 {snapshot.playbackRate.toFixed(1)}x</button> : null}<button onClick={toggleFullscreen} disabled={viewerClosed} aria-label={isFullscreen ? "退出全屏" : "全屏"}>{isFullscreen ? "退出全屏" : "全屏"}</button><strong>{formatTime(snapshot.currentTime)} / {formatTime(snapshot.duration)}</strong></div>
          <SubtitleControls subtitle={status.subtitle} controller={controllerRef.current} />
        </> : null}
      </div>
      <SyncDiagnostics status={status} snapshot={snapshot} sessionId={sessionId} />
    </section>
  </main>;
};

export default function App() {
  const mode = location.pathname === "/replay" ? "replay" : "live";
  return <DemoPage mode={mode} />;
}
