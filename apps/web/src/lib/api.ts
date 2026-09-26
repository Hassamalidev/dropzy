import type { ApiResult, CreateRoomRes, CreateSessionRes, FileKeyRes, FileMeta, JoinRes } from '@dropzy/shared';
import { API_URL } from './site';

// The few HTTP calls; everything else goes over the socket (§13).

export class HttpError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new HttpError('network');
  }
  let json: ApiResult<T>;
  try {
    json = await res.json();
  } catch {
    throw new HttpError(res.status === 503 ? 'at_capacity' : 'server_error');
  }
  if (!json.ok) throw new HttpError(json.error);
  return json.data;
}

export const api = {
  createSession: () => call<CreateSessionRes>('POST', '/v1/sessions'),
  createRoom: () => call<CreateRoomRes>('POST', '/v1/rooms'),
  join: (code: string) => call<JoinRes>('POST', '/v1/join', { code }),
  fileMeta: (ref: string) => call<FileMeta>('GET', `/v1/files/${ref}`),
  fileDownload: (ref: string) => call<{ url: string }>('POST', `/v1/files/${ref}/download`, {}),
  fileKey: (ref: string, pub: string) => call<FileKeyRes>('POST', `/v1/files/${ref}/key`, { pub }),
  report: (ref: string, reason: string, note?: string) => call<{ id: string }>('POST', '/v1/report', { ref, reason, note }),
  feedback: (type: 'feature' | 'contact', message: string, email?: string, website = '') =>
    call<{ id: string }>('POST', '/v1/feedback', { type, message, email, website }),
  ice: () => call<{ iceServers: RTCIceServer[] }>('GET', '/v1/ice'),
};

export function wsUrl(query: string): string {
  return `${API_URL.replace(/^http/, 'ws')}/v1/ws?${query}&v=1`;
}
