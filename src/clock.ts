export type ClockSnapshot = {
  currentTime: number;
  duration: number;
  playing: boolean;
  playbackRate: number;
};

type Listener = () => void;

export class FakeMediaClock {
  private anchorMediaTime: number;
  private anchorWallTime: number;
  private playing: boolean;
  private playbackRate = 1;
  private readonly listeners = new Set<Listener>();
  private timer: number | null = null;

  constructor(
    private readonly duration: number,
    initialTime = 0,
    initialPlaying = false,
  ) {
    this.anchorMediaTime = Math.max(0, Math.min(duration, initialTime));
    this.anchorWallTime = Date.now();
    this.playing = initialPlaying && this.anchorMediaTime < duration;
    this.timer = window.setInterval(() => this.emit(), 50);
  }

  private calculateTime(now = Date.now()) {
    if (!this.playing) return this.anchorMediaTime;
    return Math.min(this.duration, Math.max(0, this.anchorMediaTime + (now - this.anchorWallTime) / 1000 * this.playbackRate));
  }

  private commitAnchor(now = Date.now()) {
    this.anchorMediaTime = this.calculateTime(now);
    this.anchorWallTime = now;
    if (this.anchorMediaTime >= this.duration) this.playing = false;
  }

  private emit() {
    this.commitAnchor();
    this.listeners.forEach((listener) => listener());
  }

  getSnapshot = (): ClockSnapshot => ({
    currentTime: this.calculateTime(),
    duration: this.duration,
    playing: this.playing,
    playbackRate: this.playbackRate,
  });

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  play = () => {
    if (this.playing || this.anchorMediaTime >= this.duration) return;
    this.anchorWallTime = Date.now();
    this.playing = true;
    this.emit();
  };

  pause = () => {
    if (!this.playing) return;
    this.commitAnchor();
    this.playing = false;
    this.emit();
  };

  seek = (time: number) => {
    this.anchorMediaTime = Math.max(0, Math.min(this.duration, time));
    this.anchorWallTime = Date.now();
    this.emit();
  };

  setPlaybackRate = (rate: number) => {
    this.commitAnchor();
    this.playbackRate = Math.max(0.25, Math.min(4, rate));
    this.emit();
  };

  destroy = () => {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  };
}
