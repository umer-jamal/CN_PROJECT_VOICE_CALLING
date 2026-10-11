// Copy to runtime-config.js and replace with your provider's ICE server entries.
// This is browser-visible configuration: use scoped test TURN credentials,
// never a provider account/API secret. The local copy is ignored by Git.
window.WEBRTC_TURN_SERVERS = [
  {
    urls: [
      'turn:YOUR_TURN_HOST:3478?transport=udp',
      'turns:YOUR_TURN_HOST:443?transport=tcp'
    ],
    username: 'YOUR_TURN_USERNAME',
    credential: 'YOUR_TURN_PASSWORD'
  }
];
// Temporarily set true on both browsers to prove the relay works, then restore false.
window.WEBRTC_FORCE_RELAY = false;
