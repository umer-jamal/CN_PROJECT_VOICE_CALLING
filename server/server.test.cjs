const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('room presence assigns one chat initiator, isolates sessions and handles rejoin', () => {
  let server;
  class WSS extends EventEmitter { constructor() { super(); server = this; } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), {
    require(name) {
      if (name === 'fs') return { readFileSync: () => '' };
      if (name === 'https') return { createServer: () => ({ listen() {} }) };
      if (name === 'ws') return { Server: WSS, OPEN: 1 };
      return require(name);
    },
    __dirname, console: { log() {}, error() {} }
  });
  function client(room) {
    const c = new EventEmitter();
    c.readyState = 1;
    c.messages = [];
    c.send = data => c.messages.push(JSON.parse(data));
    c.signal = data => c.emit('message', JSON.stringify(data));
    server.emit('connection', c);
    c.signal({ type: 'join', roomId: room, deviceName: 'Browser' });
    return c;
  }
  const a = client('one'), b = client('one'), other = client('other');
  assert.equal(a.messages[0].initiator, true);
  assert.equal(b.messages[0].initiator, false);
  const sessionId = a.messages[0].sessionId;
  assert.equal(b.messages[0].sessionId, sessionId);
  a.signal({ type: 'chat-offer', sessionId, offer: { type: 'offer' } });
  assert.equal(b.messages.at(-1).type, 'chat-offer');
  assert.equal(other.messages.length, 0);
  const before = b.messages.length;
  a.signal({ type: 'chat-candidate', sessionId: 'stale' });
  assert.equal(b.messages.length, before);
  a.signal({ type: 'hangup' });
  assert.equal(b.messages.at(-1).type, 'hangup');
  assert.equal(a.chatSessionId, sessionId);
  const third = client('one');
  assert.equal(third.messages[0].type, 'room-full');
  b.emit('close');
  assert.equal(a.messages.at(-1).type, 'peer-left');
  const replacement = client('one');
  assert.notEqual(replacement.chatSessionId, sessionId);
  assert.equal(a.chatSessionId, replacement.chatSessionId);
});
