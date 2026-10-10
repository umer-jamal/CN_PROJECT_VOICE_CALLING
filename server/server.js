const fs = require('fs');
const path = require('path');
const https = require('https');
const WebSocket = require('ws');

// Load local SSL certificates created by mkcert
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem'))
};

const PORT = 8080;
const server = https.createServer(httpsOptions, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket Signaling Server is running.');
});
const wss = new WebSocket.Server({ server });
const rooms = new Map();

function removeFromRoom(ws) {
  if (!ws.roomId) return;
  const clients = rooms.get(ws.roomId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) rooms.delete(ws.roomId);
}

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket signaling server.');

  ws.on('message', (message) => {
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch (error) {
      console.error('Invalid WebSocket message:', error);
      return;
    }

    if (!payload || typeof payload.type !== 'string') return;

    if (payload.type === 'join') {
      if (typeof payload.roomId !== 'string' || !payload.roomId.trim() ||
          typeof payload.deviceName !== 'string' || !payload.deviceName.trim()) {
        console.error('Invalid join message: roomId and deviceName are required.');
        return;
      }

      if (ws.roomId === payload.roomId) {
        ws.deviceName = payload.deviceName;
        return;
      }

      removeFromRoom(ws);
      const roomClients = rooms.get(payload.roomId);
      if (roomClients && roomClients.size >= 2) {
        ws.send(JSON.stringify({ type: 'room-full', roomId: payload.roomId }));
        return;
      }

      ws.roomId = payload.roomId;
      ws.deviceName = payload.deviceName;
      if (!rooms.has(ws.roomId)) rooms.set(ws.roomId, new Set());
      rooms.get(ws.roomId).add(ws);
      return;
    }

    if (!ws.roomId) return;

    const clients = rooms.get(ws.roomId);
    if (!clients) return;
    if (!['offer', 'answer', 'candidate', 'ice-candidate', 'hangup', 'reject', 'end-call'].includes(payload.type)) return;
    if (payload.type === 'offer' || payload.type === 'answer') payload.deviceName = ws.deviceName;

    const forwardedMessage = JSON.stringify(payload);
    clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(forwardedMessage);
      }
    });
  });

  ws.on('close', () => {
    removeFromRoom(ws);
    console.log('Client disconnected.');
  });

  ws.on('error', (error) => {
    console.error('WebSocket Error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`Secure WebSocket Signaling Server running on wss://localhost:${PORT}`);
});