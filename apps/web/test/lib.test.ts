import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectError, receiveFile } from '../src/lib/direct/channel';
import type { Sink } from '../src/lib/sink';
import { uniqueName } from '../src/lib/zip';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('zip entry names', () => {
  it('keeps names flat and safe to unzip anywhere', () => {
    const used = new Set<string>();
    expect(uniqueName('../../etc/passwd', used)).toBe('_.._etc_passwd');
    expect(uniqueName('a\\b/c.txt', used)).toBe('a_b_c.txt');
    expect(uniqueName('12:30 notes?.txt', used)).toBe('12_30 notes_.txt');
    expect(uniqueName('bell\u0007\n.txt', used)).toBe('bell.txt');
    expect(uniqueName('invoice‮fdp.exe', used)).toBe('invoicefdp.exe');
    expect(uniqueName('report. ', used)).toBe('report');
    expect(uniqueName('...', used)).toBe('file');
    expect(uniqueName('   ', used)).toBe('file (1)');
    expect(uniqueName('café 🎉.jpg', used)).toBe('café 🎉.jpg');
  });

  it('numbers duplicates, ignoring case', () => {
    const used = new Set<string>();
    expect(uniqueName('Photo.JPG', used)).toBe('Photo.JPG');
    expect(uniqueName('photo.jpg', used)).toBe('photo (1).jpg');
    expect(uniqueName('photo.jpg', used)).toBe('photo (2).jpg');
    expect(uniqueName('README', used)).toBe('README');
    expect(uniqueName('readme', used)).toBe('readme (1)');
  });
});

describe('thumbnails', () => {
  it('never decodes more than two images at once, even as slots free up', async () => {
    let live = 0;
    let peak = 0;
    const pending: (() => void)[] = [];
    vi.stubGlobal('createImageBitmap', () => {
      live++;
      peak = Math.max(peak, live);
      return new Promise((_, reject) =>
        pending.push(() => {
          live--;
          reject(new Error('undecodable'));
        }),
      );
    });
    const { makeThumb } = await import('../src/lib/thumbs');
    const img = () => new File([new Uint8Array(1)], 'a.png', { type: 'image/png' });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const all = [makeThumb(img()), makeThumb(img()), makeThumb(img())];
    await tick();
    expect(live).toBe(2);
    pending.shift()!();
    // New calls arriving right as a slot frees (a few microtasks later) must wait behind the queued one.
    for (let hops = 0; hops < 12; hops++) {
      let p: Promise<unknown> = Promise.resolve();
      for (let i = 0; i < hops; i++) p = p.then(() => {});
      all.push(p.then(() => makeThumb(img())) as Promise<undefined>);
    }
    await tick();
    expect(peak).toBe(2);
    while (pending.length) {
      pending.shift()!();
      await tick();
    }
    expect(await Promise.all(all)).toEqual(all.map(() => undefined));
    expect(peak).toBe(2);
  });
});

describe('device name', () => {
  it('keeps a rename when storage is blocked (private mode)', async () => {
    const blocked = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('SecurityError');
      },
    };
    vi.stubGlobal('localStorage', blocked);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36', maxTouchPoints: 0 });
    const { deviceName, resolveDeviceName, setDeviceName } = await import('../src/lib/device');
    expect(deviceName()).toBe('Chrome on Windows');
    setDeviceName('Blue Fox'); // looks like an old random name, but the person chose it
    expect(deviceName()).toBe('Blue Fox');
    expect(await resolveDeviceName()).toBe('Blue Fox');
  });
});

/** A stand-in RTCDataChannel: `from` delivers a message as the peer, `sent` collects replies. */
function fakeChannel() {
  const sent: string[] = [];
  const ch = {
    binaryType: 'blob',
    readyState: 'open',
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onclose: null as (() => void) | null,
    send: (d: string) => sent.push(d),
    close: () => {
      ch.readyState = 'closed';
    },
  };
  return { ch, sent, from: (data: unknown) => ch.onmessage?.({ data }) };
}

describe('direct receive', () => {
  const sink = (): Sink & { aborted: boolean } => {
    const s = {
      aborted: false,
      write: async () => {},
      close: async () => new File([], 'x'),
      abort: async () => {
        s.aborted = true;
      },
    };
    return s;
  };
  const meta = (extra: object = {}) => JSON.stringify({ t: 'meta', id: 'AAAAAAAAAAAAAAAAAAAAAA', name: 'a.bin', size: 4, mime: '', ...extra });

  it('stops a peer that sends more bytes than it announced', async () => {
    vi.stubGlobal('window', globalThis);
    const { ch, sent, from } = fakeChannel();
    const s = sink();
    const p = receiveFile(ch as unknown as RTCDataChannel, async () => s, () => {}, () => {});
    from(meta());
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toContain('{"t":"accept"}');
    from(new Uint8Array(4).buffer);
    from(new Uint8Array(1).buffer);
    await expect(p).rejects.toEqual(new DirectError('too_big'));
    expect(s.aborted).toBe(true);
    expect(sent).toContain('{"t":"cancel"}');
    expect(ch.readyState).toBe('closed');
  });

  it('declines a meta whose thumb is not an image', async () => {
    vi.stubGlobal('window', globalThis);
    const { ch, sent, from } = fakeChannel();
    const p = receiveFile(ch as unknown as RTCDataChannel, async () => sink(), () => {}, () => {});
    from(meta({ thumb: 'javascript:alert(1)' }));
    await expect(p).rejects.toEqual(new DirectError('declined'));
    expect(sent).toEqual(['{"t":"decline","reason":"declined"}']);
  });

  it('receives a zero-byte file', async () => {
    vi.stubGlobal('window', globalThis);
    const { ch, sent, from } = fakeChannel();
    const p = receiveFile(ch as unknown as RTCDataChannel, async () => sink(), () => {}, () => {});
    from(meta({ size: 0 }));
    await new Promise((r) => setTimeout(r, 0));
    from('{"t":"end"}');
    const r = await p;
    expect(r.meta.size).toBe(0);
    expect(r.file).toBeInstanceOf(File);
    expect(sent).toContain('{"t":"ok"}');
  });
});
