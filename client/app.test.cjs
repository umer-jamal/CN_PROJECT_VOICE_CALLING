const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness() {
  const elements = new Map();
  function element() {
    return {
      value: '', children: [], disabled: true,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, handler) { this[type] = handler; },
      append(...items) { this.children.push(...items); },
      replaceChildren() { this.children = []; },
      focus() {}, play: async () => {}
    };
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const signals = [], peers = [], constraints = [];
  const tracks = [{ enabled: true, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks, getVideoTracks: () => tracks };
  class Channel {
    label = 'chat'; readyState = 'connecting'; bufferedAmount = 0; sent = [];
    send(message) { if (this.fail) throw Error('send failed'); this.sent.push(message); }
    close() { this.readyState = 'closed'; }
    open() { this.readyState = 'open'; this.onopen(); }
  }
  class Peer {
    tracks = []; channels = [];
    constructor() { peers.push(this); }
    addTrack(track) { this.tracks.push(track); }
    createDataChannel() { const c = new Channel(); this.channels.push(c); return c; }
    async createOffer() { return { type: 'offer' }; }
    async createAnswer() { return { type: 'answer' }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription(d) { this.remoteDescription = d; }
    async addIceCandidate() {}
    close() { this.closed = true; }
  }
  class Socket {
    static OPEN = 1; readyState = 1;
    send(data) { signals.push(JSON.parse(data)); }
  }
  const context = vm.createContext({
    document: { getElementById: get, createElement: element },
    window: { location: { hostname: 'localhost', host: 'localhost', protocol: 'https:', search: '?room=test' } },
    navigator: { userAgent: 'Desktop', mediaDevices: { getUserMedia: async (c) => { constraints.push(c); return stream; } } },
    URLSearchParams, WebSocket: Socket, RTCPeerConnection: Peer,
    RTCSessionDescription: function(d) { return d; }, console: { log() {}, error() {} }, alert() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context);
  const submit = (message) => { get('chat-input').value = message; get('chat-form').submit({ preventDefault() {} }); };
  return { context, get, signals, peers, constraints, tracks, Channel, submit };
}


for (const type of ['voice', 'video']) {
  test(type + ' calls are independent from standalone chat', async () => {
    const h = harness();
    await h.context.handleChatSignal({ type: 'peer-ready', sessionId: 's1', initiator: true });
    const chat = h.peers[0], channel = chat.channels[0];
    assert.equal(h.constraints.length, 0, 'chat must never request media');
    assert.equal(chat.tracks.length, 0);
    assert.equal(h.signals[0].type, 'chat-offer');
    channel.open();
    h.submit('hello before call');
    await h.context.startCall(type);
    const call = h.peers[1];
    assert.equal(call.channels.length, 0);
    assert.equal(call.tracks.length, 1);
    assert.equal(Boolean(h.constraints[0].video), type === 'video');
    h.context.toggleMute();
    assert.equal(h.tracks[0].enabled, false);
    h.context.endCall();
    assert.equal(call.closed, true);
    assert.equal(chat.closed, undefined);
    h.submit('hello after call');
    h.context.handleRemoteHangup();
    h.context.rejectCall();
    h.submit('still connected');
    assert.deepEqual(channel.sent, ['hello before call', 'hello after call', 'still connected']);
    assert.equal(h.get('chat-send').disabled, false);
    assert.equal(h.get('chat-messages').children.length, 3);
    assert.equal(h.signals.some(s => s.type === 'chat-message'), false);
  });
}

test('receiver negotiates without media, validates messages and reconnects after peer leaves', async () => {
  const h = harness();
  await h.context.handleChatSignal({ type: 'peer-ready', sessionId: 's1', initiator: false, deviceName: 'Peer' });
  const pc = h.peers[0];
  assert.equal(pc.channels.length, 0);
  await h.context.handleChatSignal({ type: 'chat-offer', sessionId: 's1', offer: { type: 'offer' } });
  assert.equal(h.signals[0].type, 'chat-answer');
  assert.equal(h.constraints.length, 0);
  const channel = new h.Channel();
  pc.ondatachannel({ channel });
  channel.open();
  channel.onmessage({ data: '<img src=x onerror=alert(1)>' });
  channel.onmessage({ data: 'x'.repeat(2001) });
  channel.onmessage({ data: new ArrayBuffer(2) });
  assert.equal(h.get('chat-messages').children.length, 1);
  assert.equal(h.get('chat-messages').children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  h.submit('   ');
  h.submit('x'.repeat(2001));
  channel.bufferedAmount = 70000;
  h.submit('busy');
  assert.equal(channel.sent.length, 0);
  channel.bufferedAmount = 0;
  channel.fail = true;
  h.submit('keep draft');
  assert.equal(h.get('chat-input').value, 'keep draft');
  await h.context.handleChatSignal({ type: 'peer-left' });
  assert.equal(pc.closed, true);
  assert.equal(h.get('chat-send').disabled, true);
  await h.context.handleChatSignal({ type: 'peer-ready', sessionId: 's2', initiator: true });
  await h.context.handleChatSignal({ type: 'chat-answer', sessionId: 's1', answer: { type: 'answer' } });
  assert.equal(h.peers[1].remoteDescription, undefined, 'stale signaling must be ignored');
  h.peers[1].channels[0].open();
  h.submit('reconnected');
  assert.equal(h.get('chat-messages').children.length, 2);
});
