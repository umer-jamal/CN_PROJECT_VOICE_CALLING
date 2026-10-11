let peerConnection = null;
let localStream = null;
let iceCandidateQueue = [];
let pendingOffer = null;
let currentCallType = 'video';
let remoteDeviceName = 'Remote Peer';
let chatChannel = null;
let chatPeerConnection = null;
let chatSessionId = null;
let chatRemoteName = 'Remote Peer';
let chatSignalQueue = Promise.resolve();
const MAX_CHAT_LENGTH = 2000;
const MAX_CHAT_BUFFER = 64 * 1024;

function setChatStatus(message) {
  document.getElementById('chat-status').textContent = message;
  const ready = chatChannel?.readyState === 'open';
  document.getElementById('chat-input').disabled = !ready;
  document.getElementById('chat-send').disabled = !ready;
}

function closeChat(message = 'Waiting for the other user...') {
  chatSessionId = null;
  if (chatPeerConnection) {
    chatPeerConnection.ondatachannel = null;
    chatPeerConnection.onicecandidate = null;
    chatPeerConnection.onconnectionstatechange = null;
    chatPeerConnection.close();
    chatPeerConnection = null;
  }
  if (chatChannel) {
    chatChannel.onopen = null;
    chatChannel.onmessage = null;
    chatChannel.onclose = null;
    chatChannel.onerror = null;
    chatChannel.close();
    chatChannel = null;
  }
  setChatStatus(message);
}

function appendChatMessage(sender, message) {
  const messages = document.getElementById('chat-messages');
  const item = document.createElement('p');
  const label = document.createElement('strong');
  label.textContent = `${sender}: `;
  const body = document.createElement('span');
  body.textContent = message;
  item.append(label, body);
  messages.append(item);
  // Bound the in-memory transcript during long conversations.
  if (messages.children.length > 200) messages.firstElementChild.remove();
  messages.scrollTop = messages.scrollHeight;
}

function setupChatChannel(channel, pc) {
  if (pc !== chatPeerConnection || channel.label !== 'chat' || chatChannel) {
    channel.close();
    return;
  }
  chatChannel = channel;
  setChatStatus('Connecting chat...');
  channel.onopen = () => setChatStatus('Chat connected');
  channel.onclose = () => setChatStatus('Chat disconnected. Refresh to reconnect.');
  channel.onerror = () => setChatStatus('Chat error. Try sending again or refresh to reconnect.');
  channel.onmessage = (event) => {
    if (typeof event.data !== 'string' || event.data.length > MAX_CHAT_LENGTH || !event.data.trim()) return;
    appendChatMessage(chatRemoteName, event.data);
  };
  if (channel.readyState === 'open') setChatStatus('Chat connected');
}

document.getElementById('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;
  if (!chatChannel || chatChannel.readyState !== 'open') {
    setChatStatus('Chat is not connected.');
    return;
  }
  if (message.length > MAX_CHAT_LENGTH) {
    setChatStatus(`Keep messages under ${MAX_CHAT_LENGTH + 1} characters.`);
    return;
  }
  if (chatChannel.bufferedAmount > MAX_CHAT_BUFFER) {
    setChatStatus('Chat is busy. Wait a moment and try again.');
    return;
  }
  try {
    chatChannel.send(message);
    appendChatMessage('You', message);
    input.value = '';
    setChatStatus('Chat connected');
    input.focus();
  } catch (err) {
    console.error('Unable to send chat message:', err);
    setChatStatus('Message was not sent. Try again.');
  }
});

// A separately reachable TURN service can override these defaults at runtime.
const configuredTurnServers = Array.isArray(window.WEBRTC_TURN_SERVERS)
  ? window.WEBRTC_TURN_SERVERS
  : (/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname) ? [{
      urls: [
        `turn:${window.location.hostname}:3478?transport=udp`,
        `turn:${window.location.hostname}:3478?transport=tcp`
      ],
      username: 'webrtcuser',
      credential: 'webrtcpass'
    }] : []);

const rtcConfig = {
  iceTransportPolicy: window.WEBRTC_FORCE_RELAY === true ? 'relay' : 'all',
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    ...configuredTurnServers
  ]
};

// Extract Room ID and Device Identifier
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room') || 'default-room';
const deviceName = navigator.userAgentData?.platform || (navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Browser');

document.getElementById('room-id-display').innerText = `Room: ${roomId}`;

// WebSocket Signaling Server Connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

ws.onopen = () => {
  document.getElementById('status-text').innerText = 'Connected to Server';
  ws.send(JSON.stringify({ type: 'join', roomId, deviceName }));
};

ws.onmessage = async (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log('Received signaling message:', data.type);

    if (['peer-ready', 'peer-left', 'room-full', 'chat-offer', 'chat-answer', 'chat-candidate'].includes(data.type)) {
      chatSignalQueue = chatSignalQueue.then(() => handleChatSignal(data)).catch((err) => {
        console.error('Chat signaling failed:', err);
        closeChat('Chat connection failed. Refresh to reconnect.');
      });
      await chatSignalQueue;
      return;
    }
    if (data.type === 'offer') await handleOffer(data);
    else if (data.type === 'answer') await handleAnswer(data);
    else if (data.type === 'candidate') await handleCandidate(data);
    else if (data.type === 'hangup' || data.type === 'reject') handleRemoteHangup();
  } catch (err) {
    console.error('Error handling WebSocket message:', err);
  }
};

// Chat signaling is serialized independently from media call signaling.
function sendChatSignal(type, fields = {}) {
  if (ws.readyState !== WebSocket.OPEN) throw new Error('Signaling is disconnected.');
  ws.send(JSON.stringify({ type, sessionId: chatSessionId, ...fields }));
}

async function handleChatSignal(data) {
  if (data.type === 'peer-ready') {
    closeChat();
    chatSessionId = data.sessionId;
    chatRemoteName = data.deviceName || 'Remote Peer';
    const pc = new RTCPeerConnection(rtcConfig);
    chatPeerConnection = pc;
    pc.ondatachannel = (event) => setupChatChannel(event.channel, pc);
    // Send SDP before candidates, including browsers that gather ICE early.
    const candidates = [];
    let descriptionSent = false;
    pc.sendDescription = (type, fields) => {
      if (pc !== chatPeerConnection) return;
      sendChatSignal(type, fields);
      descriptionSent = true;
      candidates.splice(0).forEach(candidate => sendChatSignal('chat-candidate', { candidate }));
    };
    pc.onicecandidate = (event) => {
      if (pc !== chatPeerConnection || !event.candidate) return;
      if (!descriptionSent) candidates.push(event.candidate);
      else if (ws.readyState === WebSocket.OPEN) sendChatSignal('chat-candidate', { candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc === chatPeerConnection && pc.connectionState === 'failed') {
        closeChat('Chat connection failed. Refresh to reconnect.');
      }
    };
    setChatStatus('Connecting chat...');
    if (data.initiator) {
      setupChatChannel(pc.createDataChannel('chat'), pc);
      await pc.setLocalDescription(await pc.createOffer());
      pc.sendDescription('chat-offer', { offer: pc.localDescription });
    }
    return;
  }
  if (data.type === 'peer-left') {
    closeChat();
    handleRemoteHangup();
    return;
  }
  if (data.type === 'room-full') {
    closeChat('This room already has two users. Choose another room.');
    return;
  }
  const pc = chatPeerConnection;
  if (!pc || data.sessionId !== chatSessionId) return;
  if (data.type === 'chat-offer') {
    await pc.setRemoteDescription(data.offer);
    await pc.setLocalDescription(await pc.createAnswer());
    pc.sendDescription('chat-answer', { answer: pc.localDescription });
  } else if (data.type === 'chat-answer') {
    await pc.setRemoteDescription(data.answer);
  } else if (data.type === 'chat-candidate' && data.candidate) {
    await pc.addIceCandidate(data.candidate);
  }
}

ws.onclose = () => closeChat('Disconnected from server. Refresh to reconnect.');
ws.onerror = () => setChatStatus('Signaling connection error.');

// Request Camera / Microphone Stream
async function getMedia(callType = currentCallType) {
  currentCallType = callType === 'voice' ? 'voice' : 'video';
  const enableVideo = currentCallType === 'video';
  const localVideo = document.getElementById('localVideo');
  const videoContainer = document.getElementById('video-container');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: enableVideo
        ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        : false
    });

    localStream = stream;
    if (localVideo) localVideo.srcObject = enableVideo ? stream : null;
    if (videoContainer) videoContainer.classList.toggle('hidden', !enableVideo);
    return true;
  } catch (err) {
    console.error('Media access error:', err);
    alert(`Unable to access ${enableVideo ? 'camera and microphone' : 'microphone'}. Check browser permissions.`);
    endCall(false);
    return false;
  }
}

// Instantiate Peer Connection
function createPeerConnection() {
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  if (!localStream) throw new Error('Local media must be captured before creating the peer connection.');

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnection = pc;
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, roomId }));
      }
    }
  };

  pc.ontrack = (event) => {
    const remoteVideo = document.getElementById('remoteVideo');
    if (!remoteVideo) {
      console.error('Remote video element was not found.');
      return;
    }

    try {
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      } else {
        const remoteStream = remoteVideo.srcObject || new MediaStream();
        if (!remoteStream.getTracks().some(track => track.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
        remoteVideo.srcObject = remoteStream;
      }
      remoteVideo.play().catch(err => console.error('Could not play remote media:', err));
    } catch (err) {
      console.error('Could not attach remote media stream:', err);
      endCall(false);
    }
  };

  pc.onconnectionstatechange = () => {
    const statusText = document.getElementById('status-text');
    console.log('Peer connection state:', pc.connectionState);

    if (pc.connectionState === 'connected') {
      statusText.innerText = `Connected (${currentCallType.toUpperCase()} call with ${remoteDeviceName})`;
    } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      endCall(false);
    }
  };

  return pc;
}

// Call Action Triggers
async function startCall(callType) {
  currentCallType = callType === 'voice' ? 'voice' : 'video';
  iceCandidateQueue = [];

  try {
    if (!await getMedia(currentCallType)) return;

    const pc = createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
      type: 'offer',
      offer: pc.localDescription,
      callType: currentCallType,
      deviceName,
      roomId
    }));

    document.getElementById('status-text').innerText = `Calling... (${currentCallType.toUpperCase()})`;
    document.getElementById('lobby-controls').classList.add('hidden');
    document.getElementById('incall-controls').classList.remove('hidden');
  } catch (err) {
    console.error('Error starting call:', err);
    endCall(false);
  }
}

async function handleOffer(data, acceptedPeerConnection = null) {
  if (!acceptedPeerConnection) {
    if (!data || !data.offer) {
      console.error('Received an offer without a session description.');
      return;
    }
    if (peerConnection || pendingOffer) return;

    pendingOffer = data;
    currentCallType = data.callType === 'voice' ? 'voice' : 'video';
    remoteDeviceName = data.deviceName || 'Remote Peer';
    document.getElementById('incoming-type-text').innerText = `Incoming ${currentCallType.toUpperCase()} Call`;
    document.getElementById('caller-name').innerText = `From: ${remoteDeviceName}`;
    document.getElementById('incoming-modal').classList.remove('hidden');
    return;
  }

  try {
    await acceptedPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    await processBufferedCandidates(acceptedPeerConnection);
  } catch (err) {
    console.error('Error setting remote offer or applying queued ICE candidates:', err);
    endCall(false);
    throw err;
  }
}

async function acceptCall() {
  try {
    if (!pendingOffer) throw new Error('There is no incoming offer to accept.');

    if (!await getMedia(currentCallType)) return;

    const offer = pendingOffer;
    const pc = createPeerConnection();
    await handleOffer(offer, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({
      type: 'answer',
      answer: pc.localDescription,
      callType: currentCallType,
      deviceName,
      roomId: roomId
    }));

    pendingOffer = null;
    document.getElementById('incoming-modal').classList.add('hidden');
    document.getElementById('lobby-controls').classList.add('hidden');
    document.getElementById('incall-controls').classList.remove('hidden');
  } catch (err) {
    console.error('Error accepting call:', err);
    endCall(false);
  }
}

function rejectCall() {
  document.getElementById('incoming-modal').classList.add('hidden');
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'reject', roomId }));
  }
  pendingOffer = null;
  iceCandidateQueue = [];
}

async function handleAnswer(data) {
  try {
    if (!peerConnection) throw new Error('Cannot apply an answer without an active peer connection.');
    const pc = peerConnection;
    if (data.deviceName) remoteDeviceName = data.deviceName;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    await processBufferedCandidates(pc);
  } catch (err) {
    console.error('Error setting remote answer:', err);
    endCall(false);
  }
}

async function handleCandidate(data) {
  try {
    if (!data || !data.candidate) return;
    const candidate = new RTCIceCandidate(data.candidate);
    if (peerConnection && peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(candidate);
    } else {
      iceCandidateQueue.push(candidate);
    }
  } catch (err) {
    console.error('Error handling candidate:', err);
    endCall(false);
  }
}

async function processBufferedCandidates(pc = peerConnection) {
  if (!pc || !pc.remoteDescription) return;

  while (iceCandidateQueue.length > 0) {
    const candidate = iceCandidateQueue.shift();
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('Error adding buffered ICE candidate:', err);
      throw err;
    }
  }
}

function toggleMute() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      document.getElementById('mute-btn').innerText = audioTrack.enabled ? 'Mute Audio' : 'Unmute Audio';
    }
  }
}

function toggleCamera() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      document.getElementById('camera-btn').innerText = videoTrack.enabled ? 'Disable Camera' : 'Enable Camera';
    }
  }
}

function endCall(notifyRemote = true) {
  if (notifyRemote && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'hangup', roomId }));
    } catch (err) {
      console.error('Unable to send hangup signal:', err);
    }
  }

  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  resetCallUI();
}

function handleRemoteHangup() {
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  resetCallUI();
}

function resetCallUI() {
  pendingOffer = null;
  iceCandidateQueue = [];
  currentCallType = 'video';
  remoteDeviceName = 'Remote Peer';
  document.getElementById('status-text').innerText = 'Call Ended';
  document.getElementById('incoming-modal').classList.add('hidden');
  document.getElementById('video-container').classList.add('hidden');
  document.getElementById('incall-controls').classList.add('hidden');
  document.getElementById('lobby-controls').classList.remove('hidden');

  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
}
