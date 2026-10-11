# CN_PROJECT_VOICE_CALLING  Tayyab Here too

## Text chat

Open the app on two browsers/devices with the same `?room=your-room`. Chat connects automatically once both users join. It uses a reliable, ordered WebRTC DataChannel with its own media-free peer connection: no microphone/camera permission or call acceptance is needed. Voice and video calls remain separate options, and ending or rejecting a call keeps chat connected.

Press Enter or Send to send a message (maximum 2,000 characters). The most recent 200 messages remain locally visible until page reload. Messages are not stored on the server, and both users must be online; offline delivery is not supported. Leaving the room closes the chat connection; rejoining creates a fresh connection. Refresh after a connection failure.

The signaling server must be restarted with these changes: it now announces peer arrival/departure and relays chat SDP/ICE separately from call signaling. Message content travels through the DataChannel.

Run `node --test client/app.test.cjs server/server.test.cjs`. For a browser smoke test, join the same room in two browsers and exchange messages before any call, during voice/video calls, and after ending or rejecting calls. Check audio/video and mute/camera controls, then reload one browser and verify chat reconnects.
