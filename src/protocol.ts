export const SYNC_CHANNEL = "SUPER4D_MEDIA_SYNC" as const;
export const SYNC_VERSION = 1 as const;

export type SyncMode = "live" | "replay";
export type ParentMessageType = "INIT" | "SYNC_STATE" | "PLAY" | "PAUSE" | "RATE_CHANGE" | "SEEK_BEGIN" | "SEEK_COMMIT" | "END";
export type ViewerMessageType = "SYNC_READY" | "VIEWER_TIME" | "VIEWER_STATE" | "LOADING" | "ERROR" | "ENDED";
export type SyncPayload = { mediaTime?: number; sentAt?: number; playing?: boolean; playbackRate?: number; duration?: number; currentTime?: number; loading?: boolean; error?: string };
export type SyncMessage = { channel: typeof SYNC_CHANNEL; version: typeof SYNC_VERSION; sessionId: string; sequence: number; mode: SyncMode; type: ParentMessageType | ViewerMessageType; payload?: SyncPayload };
export type ViewerStatus = { ready: boolean; loading: boolean; currentTime: number | null; duration: number | null; lastMessage: string; error: string | null; lastSequence: number };

export const isSyncMessage = (value: unknown): value is SyncMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SyncMessage>;
  return message.channel === SYNC_CHANNEL && message.version === SYNC_VERSION && typeof message.sessionId === "string" && Number.isFinite(message.sequence) && (message.mode === "live" || message.mode === "replay") && typeof message.type === "string";
};

export const makeSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
