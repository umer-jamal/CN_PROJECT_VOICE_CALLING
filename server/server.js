const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');

// Load local SSL certificates created by mkcert
const serverOptions = {
  key: fs.readFileSync('./localhost+1-key.pem'),
  cert: fs.readFileSync('./localhost+1.pem')
};

const PORT = 8080;
const server = https.createServer(serverOptions);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket signaling server.');

  ws.on('message', (message) => {
    // Broadcast signaling messages (offer, answer, ice-candidate) to all other connected peers
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
  });

  ws.on('error', (error) => {
    console.error('WebSocket Error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`Secure WebSocket Signaling Server running on wss://localhost:${PORT}`);
});