import { DIRECT_IDLE_CLOSE, ICE_GATHER_CAP, type SignalData } from '@dropzy/shared';

// One RTCPeerConnection per pair of peers, created on first need, closed after 2 min idle (§9.2).
// Non-trickle signaling (one offer + one answer) with the "perfect negotiation" pattern;
// the polite peer is the one with the lower peerId.

export const STUN: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];

export class PeerConn {
  pc: RTCPeerConnection;
  private makingOffer = false;
  private polite: boolean;
  private open = 0;
  private idleTimer = 0;
  closed = false;
  onChannel: (ch: RTCDataChannel) => void = () => {};
  onClose: () => void = () => {};

  constructor(
    public peerId: string,
    me: string,
    private signal: (d: SignalData) => void,
    iceServers: RTCIceServer[],
  ) {
    this.polite = me < peerId;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        await gathered(this.pc);
        const sdp = this.pc.localDescription?.sdp;
        if (sdp && this.pc.localDescription?.type === 'offer') this.signal({ kind: 'offer', sdp });
      } catch {
        // a newer negotiation will follow
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.ondatachannel = (e) => {
      this.track(e.channel);
      this.onChannel(e.channel);
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') this.close(false);
    };
    this.armIdle();
  }

  async onSignal(d: SignalData) {
    if (d.kind === 'bye') {
      this.close(false);
      return;
    }
    const collision = d.kind === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
    if (!this.polite && collision) return; // ignore the other side's offer
    await this.pc.setRemoteDescription({ type: d.kind, sdp: d.sdp });
    if (d.kind === 'offer') {
      await this.pc.setLocalDescription();
      await gathered(this.pc);
      const sdp = this.pc.localDescription?.sdp;
      if (sdp) this.signal({ kind: 'answer', sdp });
    }
  }

  channel(label: string): RTCDataChannel {
    const ch = this.pc.createDataChannel(label, { ordered: true });
    this.track(ch);
    return ch;
  }

  private track(ch: RTCDataChannel) {
    this.open++;
    clearTimeout(this.idleTimer);
    ch.addEventListener('close', () => {
      this.open = Math.max(0, this.open - 1);
      if (!this.open) this.armIdle();
    });
  }

  private armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.close(true), DIRECT_IDLE_CLOSE);
  }

  close(sayBye = true) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    if (sayBye) this.signal({ kind: 'bye' });
    this.pc.close();
    this.onClose();
  }
}

/** Wait for ICE gathering to finish, capped at 2.5 s. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, ICE_GATHER_CAP);
    pc.addEventListener('icegatheringstatechange', check);
  });
}
