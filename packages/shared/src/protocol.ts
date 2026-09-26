// Realtime protocol shared by the web app and the Worker (SPEC §8.2).

export type DeviceType = 'iphone' | 'ipad' | 'android' | 'windows' | 'mac' | 'linux' | 'chromeos' | 'other';
export type Peer = { peerId: string; name: string; type: DeviceType };
export type PeerList = Peer[] | { count: number };

export type SpaceKind = 'net' | 'ses' | 'room';
export type Scope = 'wifi' | 'pass' | 'ses' | 'room';
export type UploadsState = 'on' | 'paused' | 'off';

export type SpaceInfo = {
  kind: SpaceKind;
  ref: string; // base64url(DO id) → used to build /f links
  expiresAt?: number;
  maxExpiresAt?: number; // ses, room
  code?: string;
  locked?: boolean; // room
  busy?: boolean;
  viaPass?: boolean; // net
  uploads: UploadsState;
};

export type Item = {
  id: string;
  type: 'text' | 'file';
  mine: boolean;
  from: { name: string; type: DeviceType };
  createdAt: number;
  expiresAt: number;
  code?: string;
  body?: string; // text (base64 iv|ciphertext when e2ee)
  name?: string;
  mime?: string;
  size?: number; // file; name/mime absent when e2ee
  encMeta?: string;
  thumb?: string;
  e2ee?: boolean;
  status?: 'uploading' | 'ready';
  pct?: number;
  burn?: boolean;
};

export type Caps = { direct: boolean; maxDirectBytes: number };

export type SignalData = { kind: 'offer' | 'answer'; sdp: string } | { kind: 'bye' };

export type C2S =
  | { t: 'hello'; rid: string; deviceId: string; name: string; type: DeviceType; caps: Caps }
  | { t: 'text.add'; rid: string; cid: string; body: string }
  | { t: 'item.delete'; rid: string; id: string; deleteToken?: string }
  | {
      t: 'upload.init';
      rid: string;
      cid: string;
      size: number;
      name?: string;
      mime?: string;
      encMeta?: string;
      thumb?: string;
      e2ee: boolean;
      burn: boolean;
    }
  | { t: 'upload.urls'; rid: string; id: string; parts: number[] }
  | { t: 'upload.progress'; id: string; pct: number }
  | { t: 'upload.complete'; rid: string; id: string; parts?: { n: number; etag: string }[] }
  | { t: 'upload.abort'; rid: string; id: string }
  | { t: 'download.url'; rid: string; id: string }
  | { t: 'space.extend'; rid: string }
  | { t: 'room.lock'; rid: string; locked: boolean }
  | { t: 'pass.create'; rid: string }
  | { t: 'find'; rid: string; code: string }
  | { t: 'device.rename'; rid: string; name: string }
  | { t: 'signal'; to: string; data: SignalData };

export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'ended'
  | 'forbidden'
  | 'rate_limited'
  | 'too_large'
  | 'space_full'
  | 'uploads_paused'
  | 'uploads_off'
  | 'locked'
  | 'max_length';

export type S2C =
  | { t: 'ack'; rid: string; ok: true; data?: unknown }
  | { t: 'ack'; rid: string; ok: false; error: ErrorCode; retryAfter?: number }
  | { t: 'state'; you: { peerId: string }; space: SpaceInfo; items: Item[]; peers: PeerList }
  | { t: 'item.added' | 'item.updated'; item: Item }
  | { t: 'item.removed'; id: string }
  | { t: 'peers'; peers: PeerList }
  | { t: 'space'; space: SpaceInfo }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'ended' };

// Ack payloads
export type TextAddAck = { id: string; deleteToken?: string };
export type UploadInitAck =
  | { id: string; mode: 'single'; url: string; headers: Record<string, string>; deleteToken?: string }
  | {
      id: string;
      mode: 'multipart';
      partSize: number;
      partCount: number;
      urls: Record<number, string>;
      deleteToken?: string;
    };
export type UploadUrlsAck = { urls: Record<number, string> };
export type DownloadUrlAck = { url: string };
export type PassCreateAck = { pass: string; code: string; expiresAt: number };
export type FindAck = { item: Item };

// HTTP API
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ErrorCode | string };
export type CreateSessionRes = { token: string; expiresAt: number };
export type CreateRoomRes = { token: string; code: string; expiresAt: number };
export type JoinRes = { kind: 'room'; token: string } | { kind: 'pass'; pass: string } | { kind: 'file'; ref: string };
export type FileMeta = {
  name?: string;
  mime?: string;
  size: number;
  encMeta?: string;
  thumb?: string;
  e2ee: boolean;
  from: { name: string; type: DeviceType };
  createdAt: number;
  expiresAt: number;
  burn: boolean;
};
export type HealthRes = { status: 'ok'; storage: boolean; turn: boolean; maxCloudFileBytes: number };

// WebSocket close codes (§8.1)
export const CLOSE = {
  BAD_REQUEST: 4400,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  ENDED: 4410,
  RATE_LIMITED: 4429,
  AT_CAPACITY: 4503,
} as const;
