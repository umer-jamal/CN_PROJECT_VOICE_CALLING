let peerConnection = null;
let localStream = null;
let iceCandidateQueue = [];
let pendingOffer = null;
let currentCallType = 'video';
let remoteDeviceName = 'Remote Peer';
let heartbeatInterval = null;

// Call Duration Timer & Web Audio States
let callTimerInterval = null;
let callStartTime = 0;
let audioCtx = null;
let outgoingToneInterval = null;

// Socket-style Clean Hostname Generator
function getDeviceHostName() {
  const ua = navigator.userAgent;
  let os = "PC";
  if (ua.includes("Win")) os = "Windows-PC";
  else if (ua.includes("Mac")) os = "macOS-Device";
  else if (ua.includes("Linux")) os = "Linux-Workstation";
  else if (ua.includes("Android")) os = "Android-Device";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS-Device";

  const hostId = Math.floor(1000 + Math.random() * 9000);
  return `${os}-${hostId}`;
}

const deviceName = getDeviceHostName();

// Audio Context Helper
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Outgoing Dial Tone (Synthesized Ringback Tone)
function playOutgoingDialTone() {
  stopOutgoingDialTone();
  try {
    const ctx = getAudioContext();
    const playBeep = () => {
      try {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        // Standard 440 Hz + 480 Hz US dual ringback tone
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.value = 0.05; // Smooth volume

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();

        // 1.5 seconds ring duration
        setTimeout(() => {
          try {
            osc1.stop();
            osc2.stop();
          } catch (e) {}
        }, 1500);
      } catch (e) {
        console.warn('Outgoing tone play error:', e);
      }
    };

    playBeep();
    // Repeat ringback tone every 4.5 seconds until answered
    outgoingToneInterval = setInterval(playBeep, 4500);
  } catch (e) {
    console.warn('Audio Context init error:', e);
  }
}

function stopOutgoingDialTone() {
  if (outgoingToneInterval) {
    clearInterval(outgoingToneInterval);
    outgoingToneInterval = null;
  }
}

// Incoming Audio Ringtone (HTML5 Audio Element)
function playRingtone() {
  const audio = document.getElementById('incoming-ringtone');
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(err => console.warn('Ringtone autoplay prevented by browser:', err));
  }
}

function stopRingtone() {
  const audio = document.getElementById('incoming-ringtone');
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

// Synthesized Hangup / Disconnect Tone
function playHangupSound() {
  stopRingtone();
  stopOutgoingDialTone();
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.warn('Hangup audio effect error:', e);
  }
}

// Live Call Duration Timer
function startCallTimer() {
  stopCallTimer();
  callStartTime = Date.now();
  const timerDisplay = document.getElementById('call-timer');
  if (timerDisplay) {
    timerDisplay.innerText = '00:00';
    timerDisplay.classList.remove('hidden');
  }

  callTimerInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    if (timerDisplay) timerDisplay.innerText = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  const timerDisplay = document.getElementById('call-timer');
  if (timerDisplay) {
    timerDisplay.innerText = '00:00';
    timerDisplay.classList.add('hidden');
  }
}

// TURN Configuration for Cross-Network Traversal
// Free Open Relay configuration (No paid account required)
const configuredTurnServers = [
  {
    urls: [
      "turn:global.relay.metered.ca:80",
      "turn:global.relay.metered.ca:80?transport=tcp",
      "turn:global.relay.metered.ca:443",
      "turn:global.relay.metered.ca:443?transport=tcp",
      "turns:global.relay.metered.ca:443?transport=tcp"
    ],
    username: "60b228feb645cbed739f45c6",
    credential: "wkm4mKVNthCS53Rp"
  }
];
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    ...configuredTurnServers
  ]
};
// const rtcConfig = {
//   iceTransportPolicy: 'relay', // <-- FORCES WebRTC to ONLY use TURN servers
//   iceServers: [
//     { urls: 'stun:stun.l.google.com:19302' },
//     ...configuredTurnServers
//   ]
// };

// URL Params & Room Setup
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room') || 'default-room';
const roomIdDisplay = document.getElementById('room-id-display');
if (roomIdDisplay) roomIdDisplay.innerText = `Room: ${roomId}`;

// WebSocket Signaling Server Connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

ws.onopen = () => {
  const statusText = document.getElementById('status-text');
  if (statusText) statusText.innerText = 'Connected to Server';
  ws.send(JSON.stringify({ type: 'join', roomId, deviceName }));

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
};

ws.onclose = () => {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
};

ws.onmessage = async (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log('Received signaling message:', data.type);

    if (data.type === 'offer') await handleOffer(data);
    else if (data.type === 'answer') await handleAnswer(data);
    else if (data.type === 'candidate') await handleCandidate(data);
    else if (data.type === 'hangup' || data.type === 'reject') handleRemoteHangup();
  } catch (err) {
    console.error('Error handling WebSocket message:', err);
  }
};

// Media Stream Access
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

// Peer Connection Setup
function createPeerConnection() {
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  if (!localStream) throw new Error('Local media must be captured before creating peer connection.');

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnection = pc;
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, roomId }));
    }
  };

  pc.ontrack = (event) => {
    const remoteVideo = document.getElementById('remoteVideo');
    const waitingOverlay = document.getElementById('waiting-overlay');
    if (!remoteVideo) return;

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

      if (waitingOverlay) waitingOverlay.classList.add('hidden');
      remoteVideo.play().catch(err => console.error('Could not play remote media:', err));
    } catch (err) {
      console.error('Could not attach remote media stream:', err);
      endCall(false);
    }
  };

  let disconnectTimer = null;

  pc.onconnectionstatechange = () => {
    const statusText = document.getElementById('status-text');
    const waitingOverlay = document.getElementById('waiting-overlay');
    console.log('Peer connection state:', pc.connectionState);

    if (pc.connectionState === 'connected') {
      stopOutgoingDialTone(); // Silence outgoing dial tone once media connects
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      if (statusText) statusText.innerText = `Connected (${currentCallType.toUpperCase()} call with ${remoteDeviceName})`;
      if (waitingOverlay) waitingOverlay.classList.add('hidden');
      
      startCallTimer();
    } else if (pc.connectionState === 'disconnected') {
      if (statusText) statusText.innerText = 'Reconnecting call...';
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          if (peerConnection && pc.connectionState === 'disconnected') endCall(false);
        }, 10000);
      }
    } else if (['failed', 'closed'].includes(pc.connectionState)) {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      endCall(false);
    }
  };

  return pc;
}

// Call Handlers
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

    const statusText = document.getElementById('status-text');
    if (statusText) statusText.innerText = `Calling... (${currentCallType.toUpperCase()})`;
    document.getElementById('lobby-controls')?.classList.add('hidden');
    document.getElementById('incall-controls')?.classList.remove('hidden');

    // Play synthesized outgoing dial tone while waiting for answer
    playOutgoingDialTone();
  } catch (err) {
    console.error('Error starting call:', err);
    endCall(false);
  }
}

async function handleOffer(data, acceptedPeerConnection = null) {
  if (!acceptedPeerConnection) {
    if (!data || !data.offer) return;

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    iceCandidateQueue = [];
    pendingOffer = data;
    currentCallType = data.callType === 'voice' ? 'voice' : 'video';
    remoteDeviceName = data.deviceName || 'Remote Peer';

    const incomingType = document.getElementById('incoming-type-text');
    const callerName = document.getElementById('caller-name');
    if (incomingType) incomingType.innerText = `Incoming ${currentCallType.toUpperCase()} Call`;
    if (callerName) callerName.innerText = `From: ${remoteDeviceName}`;

    document.getElementById('incoming-modal')?.classList.remove('hidden');
    playRingtone();
    return;
  }

  try {
    await acceptedPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    await processBufferedCandidates(acceptedPeerConnection);
  } catch (err) {
    console.error('Error setting remote offer:', err);
    endCall(false);
    throw err;
  }
}

async function acceptCall() {
  stopRingtone();
  try {
    if (!pendingOffer) throw new Error('No incoming offer to accept.');

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
      roomId
    }));

    pendingOffer = null;
    document.getElementById('incoming-modal')?.classList.add('hidden');
    document.getElementById('lobby-controls')?.classList.add('hidden');
    document.getElementById('incall-controls')?.classList.remove('hidden');
  } catch (err) {
    console.error('Error accepting call:', err);
    endCall(false);
  }
}

function rejectCall() {
  stopRingtone();
  playHangupSound();
  document.getElementById('incoming-modal')?.classList.add('hidden');
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'reject', roomId }));
  }
  pendingOffer = null;
  iceCandidateQueue = [];
}

async function handleAnswer(data) {
  stopOutgoingDialTone(); // Stop outgoing tone when answer is received
  try {
    if (!peerConnection) throw new Error('Cannot apply answer without active peer connection.');
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
    console.warn('Non-fatal candidate error:', err);
  }
}

async function processBufferedCandidates(pc = peerConnection) {
  if (!pc || !pc.remoteDescription) return;
  while (iceCandidateQueue.length > 0) {
    const candidate = iceCandidateQueue.shift();
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn('Ignored candidate buffer error:', err);
    }
  }
}

function toggleMute() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
  }
}

function toggleCamera() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
  }
}

function endCall(notifyRemote = true) {
  stopRingtone();
  stopOutgoingDialTone();
  playHangupSound();

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
  endCall(false);
}

function resetCallUI() {
  stopCallTimer();
  stopRingtone();
  stopOutgoingDialTone();

  pendingOffer = null;
  iceCandidateQueue = [];
  currentCallType = 'video';
  remoteDeviceName = 'Remote Peer';

  const statusText = document.getElementById('status-text');
  const waitingOverlay = document.getElementById('waiting-overlay');
  if (statusText) statusText.innerText = 'Call Ended';
  if (waitingOverlay) waitingOverlay.classList.remove('hidden');

  document.getElementById('incoming-modal')?.classList.add('hidden');
  document.getElementById('video-container')?.classList.add('hidden');
  document.getElementById('incall-controls')?.classList.add('hidden');
  document.getElementById('lobby-controls')?.classList.remove('hidden');

  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
}