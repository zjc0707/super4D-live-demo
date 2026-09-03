export const SYNC_CHANNEL = "SUPER4D_MEDIA_SYNC" as const;
export const SYNC_VERSION = 1 as const;

export type SyncMode = "live" | "replay";
export type ParentMessageType = "INIT" | "SYNC_STATE" | "PLAY" | "PAUSE" | "RATE_CHANGE" | "SEEK_BEGIN" | "SEEK_COMMIT" | "END" | "SUBTITLE_SET_TRACK" | "SUBTITLE_SET_VISIBLE" | "SUBTITLE_SET_MASK" | "SUBTITLE_SET_FONT_SCALE" | "SUBTITLE_SET_OFFSET";
export type ViewerMessageType = "SYNC_READY" | "VIEWER_TIME" | "VIEWER_STATE" | "LOADING" | "ERROR" | "ENDED" | "SUBTITLE_STATE";
const PARENT_MESSAGE_TYPES: readonly ParentMessageType[] = ["INIT", "SYNC_STATE", "PLAY", "PAUSE", "RATE_CHANGE", "SEEK_BEGIN", "SEEK_COMMIT", "END", "SUBTITLE_SET_TRACK", "SUBTITLE_SET_VISIBLE", "SUBTITLE_SET_MASK", "SUBTITLE_SET_FONT_SCALE", "SUBTITLE_SET_OFFSET"];
const VIEWER_MESSAGE_TYPES: readonly ViewerMessageType[] = ["SYNC_READY", "VIEWER_TIME", "VIEWER_STATE", "LOADING", "ERROR", "ENDED", "SUBTITLE_STATE"];
export type SubtitleState = { tracks: Array<{ id: string; language: string; label: string }>; selectedTrackId: string; visible: boolean; maskVisible: boolean; fontScale: number; verticalOffset: number; error: string | null };
export type SyncPayload = { mediaTime?: number; sentAt?: number; playing?: boolean; playbackRate?: number; duration?: number; currentTime?: number; loading?: boolean; error?: string; subtitle?: SubtitleState; trackId?: string; visible?: boolean; maskVisible?: boolean; fontScale?: number; verticalOffset?: number };
export type SyncMessage = { channel: typeof SYNC_CHANNEL; version: typeof SYNC_VERSION; sessionId: string; sequence: number; mode: SyncMode; type: ParentMessageType | ViewerMessageType; payload?: SyncPayload };
export type ViewerStatus = { ready: boolean; loading: boolean; currentTime: number | null; duration: number | null; lastMessage: string; error: string | null; lastSequence: number; subtitle: SubtitleState };

export const isSyncMessage = (value: unknown): value is SyncMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SyncMessage>;
  return message.channel === SYNC_CHANNEL && message.version === SYNC_VERSION && typeof message.sessionId === "string" && Number.isSafeInteger(message.sequence) && message.sequence >= 0 && (message.mode === "live" || message.mode === "replay") && (PARENT_MESSAGE_TYPES.includes(message.type as ParentMessageType) || VIEWER_MESSAGE_TYPES.includes(message.type as ViewerMessageType)) && (message.payload === undefined || (typeof message.payload === "object" && message.payload !== null));
};

export const isViewerMessage = (value: unknown): value is SyncMessage => {
  if (!isSyncMessage(value) || !VIEWER_MESSAGE_TYPES.includes(value.type as ViewerMessageType)) return false;
  const payload = value.payload || {};
  for (const key of ["currentTime", "duration"] as const) {
    if (payload[key] !== undefined && (typeof payload[key] !== "number" || !Number.isFinite(payload[key]) || payload[key] < 0)) return false;
  }
  if (payload.loading !== undefined && typeof payload.loading !== "boolean") return false;
  return true;
};

export const makeSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
