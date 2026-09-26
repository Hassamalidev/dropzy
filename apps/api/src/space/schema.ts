import { DEVICE_TYPES } from '@dropzy/shared';
import { z } from 'zod';

// Every socket message is validated; unknown fields are rejected (§14.2).

const rid = z.string().min(1).max(40);
const id = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const b64 = (max: number) => z.string().max(max).regex(/^[A-Za-z0-9+/=_-]*$/);

export const C2SSchema = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('hello'),
    rid,
    deviceId: z.string().min(16).max(64),
    name: z.string().max(64),
    type: z.enum(DEVICE_TYPES as [string, ...string[]]),
    caps: z.strictObject({ direct: z.boolean(), maxDirectBytes: z.number().nonnegative() }),
  }),
  z.strictObject({ t: z.literal('text.add'), rid, cid: id, body: z.string().min(1).max(250_000) }),
  z.strictObject({ t: z.literal('item.delete'), rid, id, deleteToken: z.string().max(64).optional() }),
  z.strictObject({
    t: z.literal('upload.init'),
    rid,
    cid: id,
    size: z.number().int().nonnegative(),
    name: z.string().min(1).max(1024).optional(),
    mime: z.string().max(255).optional(),
    encMeta: b64(4096).optional(),
    thumb: z.string().max(48_000).optional(),
    e2ee: z.boolean(),
    burn: z.boolean(),
  }),
  z.strictObject({
    t: z.literal('upload.urls'),
    rid,
    id,
    parts: z.array(z.number().int().min(1).max(10_000)).min(1).max(20),
  }),
  z.strictObject({ t: z.literal('upload.progress'), id, pct: z.number().min(0).max(100) }),
  z.strictObject({
    t: z.literal('upload.complete'),
    rid,
    id,
    parts: z
      .array(z.strictObject({ n: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(512) }))
      .max(10_000)
      .optional(),
  }),
  z.strictObject({ t: z.literal('upload.abort'), rid, id }),
  z.strictObject({ t: z.literal('download.url'), rid, id }),
  z.strictObject({ t: z.literal('space.extend'), rid }),
  z.strictObject({ t: z.literal('room.lock'), rid, locked: z.boolean() }),
  z.strictObject({ t: z.literal('pass.create'), rid }),
  z.strictObject({ t: z.literal('find'), rid, code: z.string().min(1).max(8) }),
  z.strictObject({ t: z.literal('device.rename'), rid, name: z.string().max(64) }),
  z.strictObject({
    t: z.literal('signal'),
    to: z.string().min(1).max(40),
    data: z.union([
      z.strictObject({ kind: z.enum(['offer', 'answer']), sdp: z.string().max(64_000) }),
      z.strictObject({ kind: z.literal('bye') }),
    ]),
  }),
]);

export type C2SMsg = z.infer<typeof C2SSchema>;
