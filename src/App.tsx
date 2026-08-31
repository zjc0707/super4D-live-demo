import { useEffect, useMemo, useRef, useState } from "react";
import { FakeMediaClock, type ClockSnapshot } from "./clock";
import { makeSessionId } from "./protocol";
import { MediaSyncController } from "./syncController";
import "./styles.css";

const VIEWER_ORIGIN = import.meta.env.VITE_VIEWER_ORIGIN || "http://localhost:5181";
const VIEWER_CONTENT_URL = import.meta.env.VITE_VIEWER_CONTENT_URL || "http://localhost:5183/timtalk_1h.4dv";
const VIEWER_PATH = "/viewer/timtalk";
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

const defaultStatus: ReturnType<MediaSyncController["getStatus"]> = { ready: false, loading: false, currentTime: null, duration: null, lastMessage: "等待 iframe", error: null, lastSequence: -1 };

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
    <div className="session">sessionId：{sessionId}</div>
    {status.error ? <div className="error">{status.error}</div> : null}
  </aside>;
};

const DemoPage = ({ mode }: { mode: "live" | "replay" }) => {
  const sessionId = useMemo(makeSessionId, []);
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
  const controllerRef = useRef<MediaSyncController | null>(null);
  const [status, setStatus] = useState(defaultStatus);
  const [dragging, setDragging] = useState(false);
  const [viewerClosed, setViewerClosed] = useState(false);
  const wasPlayingRef = useRef(false);
  const endNotifiedRef = useRef(false);

  const viewerUrl = useMemo(() => {
    const url = new URL(`${VIEWER_ORIGIN}${VIEWER_PATH}`);
    url.searchParams.set("content", VIEWER_CONTENT_URL);
    url.searchParams.set("sync", mode);
    url.searchParams.set("parent_origin", window.location.origin);
    url.searchParams.set("session_id", sessionId);
    url.searchParams.set("noui", "1");
    // Embedded playback should show the first usable frame directly without
    // the Viewer intro shader transition.
    url.searchParams.set("test_first_frame_shader", "false");
    // Bust cached Viewer documents after changing the URL-based ZIP loader.
    url.searchParams.set("sync_rev", "zip-source-v2");
    url.searchParams.set("test_start_time", String(Math.floor(initialTime)));
    return url.toString();
  }, [mode, sessionId, initialTime]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const controller = new MediaSyncController(iframe, VIEWER_ORIGIN, mode, sessionId, clock);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(() => setStatus(controller.getStatus()));
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
      controllerRef.current = null;
    };
  }, [clock, mode, sessionId]);

  // The broadcast schedule is the authoritative live boundary. Viewer
  // duration may describe only a loaded segment while it is still buffering.
  const liveEnded = mode === "live"
    && snapshot.currentTime >= LIVE_DURATION;

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
      setViewerClosed(false);
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
    if (snapshot.playing) clock.pause(); else clock.play();
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
    controllerRef.current?.sendSeekBegin(clock.getSnapshot());
  };

  const commitSeek = (value: number) => {
    if (mode !== "replay") return;
    clock.seek(value);
    setDragging(false);
    if (wasPlayingRef.current) clock.play();
    controllerRef.current?.sendSeekCommit(clock.getSnapshot());
  };

  const scheduledValue = new Date(scheduledStart.getTime() - scheduledStart.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return <main className="page">
    <header>
      <div><span className="eyebrow">super4D</span><h1>{mode === "live" ? "直播时钟 Demo" : "录播回放 Demo"}</h1></div>
      <nav><a className={mode === "live" ? "active" : ""} href="/live">直播</a><a className={mode === "replay" ? "active" : ""} href="/replay">录播</a></nav>
    </header>
    <section className="stage">
      <div className="viewer-wrap">
        {viewerClosed ? <div className="viewer-closed" role="status">直播已结束</div> : !liveStarted && mode === "live" ? <div className="viewer-closed" role="status">直播尚未开始</div> : <iframe ref={iframeRef} title="super4D viewer" src={viewerUrl} allowFullScreen />}
      </div>
      <div className="controls">
        {mode === "live" ? <><label>直播开始时间 <input type="datetime-local" value={scheduledValue} onChange={(event) => { const next = new Date(event.target.value); const nextStarted = Date.now() >= next.getTime(); setScheduledStart(next); setLiveStarted(nextStarted); clock.seek(Math.max(0, (Date.now() - next.getTime()) / 1000)); if (nextStarted) clock.play(); else clock.pause(); }} /></label><p className="hint">当前使用本地 timtalk_1h.4dv，直播时长按 1 小时模拟。</p></> : null}
        {liveEnded ? <div className="ended-banner" role="status">直播已结束</div> : null}
        {liveStarted || mode !== "live" ? <>
          {mode === "replay" ? <input aria-label="主页面录播进度条" type="range" min="0" max={snapshot.duration} step="0.01" value={snapshot.currentTime} onPointerDown={beginSeek} onChange={(event) => { if (dragging) clock.seek(Number(event.target.value)); }} onPointerUp={(event) => commitSeek(Number((event.target as HTMLInputElement).value))} /> : <div className="live-progress"><span style={{ width: `${Math.min(100, snapshot.currentTime / snapshot.duration * 100)}%` }} /></div>}
          <div className="button-row"><button onClick={togglePlay}>{snapshot.playing ? "暂停" : "播放"}</button><button onClick={changeRate}>倍速 {snapshot.playbackRate.toFixed(1)}x</button><strong>{formatTime(snapshot.currentTime)} / {formatTime(snapshot.duration)}</strong></div>
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
