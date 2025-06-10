// server.js
import 'dotenv/config';
import mongoose from 'mongoose';
import Workspace from './models/Workspace.js';
import Thread    from './models/Thread.js';
import Message   from './models/Message.js';

mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

import path    from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
import express from 'express';
import axios   from 'axios';
import cors    from 'cors';
import multer  from 'multer';
import fs      from 'fs';
import http    from 'http';
import { Server as SocketIO } from 'socket.io';

import { generateReply } from './llm.js';
import { transcribeAudio } from './stt.js';
import { generateAudio } from './tts.js';

const app = express();

// ─── Enable CORS for your front-end origin ──────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN,   // your Vercel URL
  methods: ['GET', 'POST']
}));

app.use(express.json());
// ─────────────────────────────────────────────────────────────────────────────

// ─── WORKSPACE ROUTES ─────────────────────────────────────────────────────────

// Create a new workspace
app.post('/api/workspaces', async (req, res) => {
  try {
    const { name, createdBy } = req.body;
    if (!name || !createdBy) {
      return res.status(400).json({ error: 'name and createdBy are required' });
    }
    const ws = new Workspace({ name, createdBy });
    await ws.save();
    return res.status(201).json(ws);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// List all workspaces
app.get('/api/workspaces', async (req, res) => {
  try {
    const all = await Workspace.find().sort({ createdAt: -1 });
    return res.json(all);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});


// ─── THREAD (CHANNEL) ROUTES ────────────────────────────────────────────────────

// Create a new thread (channel) under a workspace
app.post('/api/workspaces/:workspaceId/threads', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { name, createdBy } = req.body;
    if (!name || !createdBy) {
      return res.status(400).json({ error: 'Thread name and createdBy required' });
    }
    // (Optionally: verify workspaceId exists)
    const thread = new Thread({ workspaceId, name, createdBy });
    await thread.save();
    return res.status(201).json(thread);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// List all threads for a workspace
app.get('/api/workspaces/:workspaceId/threads', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const threads = await Thread.find({ workspaceId }).sort({ createdAt: 1 });
    return res.json(threads);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});



// ─── MESSAGE ROUTES ────────────────────────────────────────────────────────────

// Post a message into a thread
app.post('/api/threads/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { workspaceId, sender, content, contentType = 'text', mediaUrl = '' } = req.body;
    if (!workspaceId || !sender || !content) {
      return res.status(400).json({ error: 'workspaceId, sender, and content required.' });
    }
    // (Optionally: verify threadId & workspaceId belong together)
    const msg = new Message({ workspaceId, threadId, sender, content, contentType, mediaUrl });
    await msg.save();
    return res.status(201).json(msg);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Fetch message history for a thread (paginated)
app.get('/api/threads/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    // cursor-based or offset-based pagination (for simplicity, use ?before=<timestamp>&limit=20)
    const { before, limit = 20 } = req.query;
    const query = { threadId };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }
    // Sort descending to get newest first, then reverse on the client (or vice versa)
    const msgs = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10));

    return res.json({ messages: msgs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── Recording upload endpoint ────────────────────────────────────────────
// Temporarily store uploads, then move into a per-session folder
const upload = multer({ dest: 'tmp/' });

app.post('/api/recordings', upload.fields([
  { name: 'video',    maxCount: 1 },
  { name: 'metadata', maxCount: 1 }
]), (req, res) => {
  try {
    // Create a new directory for this session
    const sessionId  = Date.now().toString();
    const sessionDir = path.join(__dirname, 'recordings', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Move video blob
    const vid = req.files.video[0];
    fs.renameSync(vid.path, path.join(sessionDir, 'full.webm'));

    // Move metadata JSON
    const meta = req.files.metadata[0];
    fs.renameSync(meta.path, path.join(sessionDir, 'metadata.json'));

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Error saving recording:', err);
    return res.status(500).send('Error saving recording');
  }
});
// ──────────────────────────────────────────────────────────────────────────

// ─── 1. List all meetings (unique roomIds) ───────────────────────────────
app.get('/api/recordings', (req, res) => {
  const recordingsPath = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsPath)) return res.json({ meetings: [] });

  const sessions = fs.readdirSync(recordingsPath)
    .filter(d => fs.lstatSync(path.join(recordingsPath, d)).isDirectory());

  const meetings = new Set();
  sessions.forEach(sess => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(recordingsPath, sess, 'metadata.json')));
      if (meta.roomId) meetings.add(meta.roomId);
    } catch {}
  });

  res.json({ meetings: Array.from(meetings) });
});
// ──────────────────────────────────────────────────────────────────────────


// ─── 2. List all clips for one meeting ────────────────────────────────────
app.get('/api/recordings/:roomId', (req, res) => {
  const { roomId } = req.params;
  const recordingsPath = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsPath)) return res.json({ clips: [] });

  const sessions = fs.readdirSync(recordingsPath)
    .filter(d => fs.lstatSync(path.join(recordingsPath, d)).isDirectory());

  const clips = sessions.flatMap(sess => {
    const metaPath = path.join(recordingsPath, sess, 'metadata.json');
    if (!fs.existsSync(metaPath)) return [];
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath));
      if (meta.roomId === roomId) {
        return [{ sessionId: sess, metadata: meta }];
      }
    } catch {}
    return [];
  });

  res.json({ clips });
});
// ──────────────────────────────────────────────────────────────────────────


// ─── 3. Serve your recordings UI under ./public/recordings/ ───────────────
//  (make sure you have public/recordings/index.html & meeting.html)
app.use(express.static(path.join(__dirname, 'public')));

// Visiting /recordings           → public/recordings/index.html
app.get('/recordings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/recordings/index.html'));
});

// Visiting /recordings/:roomId  → public/recordings/meeting.html
app.get('/recordings/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/recordings/meeting.html'));
});

// 4) Serve raw files at /recordings/files/<sessionId>/*
app.use(
  '/recordings/files',
  express.static(path.join(__dirname, 'recordings'))
);
// ──────────────────────────────────────────────────────────────────────────

// Bot reply endpoint:
//  • If client POSTs multipart/form-data with field "audio", we STT → LLM.
//  • Else if client POSTs JSON { text }, we skip STT and go straight to LLM.
// Returns JSON { reply: "…assistant response text…" }.
app.post(
  '/bot/reply',
  upload.single('audio'),           // parse an uploaded audio file
  express.json({ limit: '1mb' }),   // parse JSON text fallback
  async (req, res) => {
    try {
      let userText;

      // 1) JSON text path (highest priority)
      if (req.body?.text) {
        userText = req.body.text;
      }
      // 2) Audio path
      else if (req.file) {
        // 1) Audio path: read and transcribe
        const audioBuf = await fs.promises.readFile(req.file.path);
        userText = await transcribeAudio(audioBuf, {
          prompt:   '',        // optional STT prompt
          language: 'auto',
          translate: false
        });
      }
      // 3) Neither provided
      else {
        return res.status(400).json({ error: 'No audio or text provided' });
      }

      // 3) LLM reply
      const replyText = await generateReply(userText);

      // 4) Return JSON
      return res.json({ reply: replyText });
    } catch (err) {
      console.error('❌ /bot/reply error:', err);
      return res.status(500).json({ error: 'Bot reply failed', details: err.toString() });
    } finally {
      // Clean up uploaded file
      if (req.file) {
        await fs.promises.unlink(req.file.path).catch(() => {/* ignore */});
      }
    }
  }
);

// TTS endpoint: accepts { text } and returns audio bytes (Opus/WebM)
app.post(
  '/bot/tts',
  express.json({ limit: '200kb' }),
  async (req, res) => {
    try {
      const text = req.body?.text;
      if (!text) return res.status(400).json({ error: 'No "text" provided' });

      // 1) get the raw axios response from ElevenLabs
      const elevenResp = await generateAudio(text);
      const audioBuffer = Buffer.from(elevenResp.data);
      const contentType = elevenResp.headers['content-type'] || 'application/octet-stream';

      // 2) proxy back the exact Content-Type
      res.set({
        'Content-Type':        contentType,
        'Content-Length':      audioBuffer.length,
        'Cache-Control':       'no-cache'
      });
      return res.send(audioBuffer);
    } catch (err) {
      // Unwrap any Buffer payload from Axios
      let detail = err.response?.data;
      if (detail && Buffer.isBuffer(detail)) {
        const str = detail.toString('utf8');
        try {
          detail = JSON.parse(str);
        } catch {
          detail = str;
        }
      }
      console.error('❌ /bot/tts error:', err.message, detail);
      return res.status(500).json({
        error:   'TTS generation failed',
        details: detail || err.message
      });
    }
  }
);
// ─────────────────────────────────────────────────────────────────────

// Health check for Render
app.get('/healthz', (req, res) => res.send('OK'));

// Serve static client files from public/
// app.use(express.static(path.join(__dirname, 'public')));    // removed: front-end now on Vercel

// --- ICE SERVERS CACHING (via Xirsys) ---
let cachedIceServers = [];


// async function refreshIceServers() {
//   try {
//     // 1. Make a PUT to the Xirsys _turn endpoint (no ?format parameter)
//     const response = await axios.put(
//       process.env.XIRSYS_ENDPOINT,
//       {}, // empty body
//       {
//         auth: {
//           username: process.env.XIRSYS_IDENT,
//           password: process.env.XIRSYS_SECRET
//         },
//         headers: {
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     const data = response.data;
//     // 2. Pull out the ICE servers array
//     const servers = data.v?.iceServers
//                   || data.d?.iceServers
//                   || data.iceServers
//                   || [];
//     if (!servers.length) {
//       console.error('❌ No iceServers array in Xirsys response:', data);
//       return;
//     }

//     // 🔧 NORMALISE url → urls  (Xirsys still returns the old key)
//     cachedIceServers = servers.map(s => {
//       // If Xirsys already gave you urls, leave them; otherwise wrap url
//       const urls = s.urls || (s.url ? [s.url] : []);
//       return {
//         urls,
//         username: s.username,
//         credential: s.credential
//       };
//     });
    
//     console.log('🔄 ICE servers refreshed:', cachedIceServers);

//   } catch (err) {
//     console.error('❌ Error fetching ICE servers:', err.message);
//   }
// }

// // Initial fetch and periodic refresh every hour
// refreshIceServers();
// setInterval(refreshIceServers, 1000 * 60 * 60);

// ─── USE ONLY YOUR EC2 coturn ───────────────────────────────
async function refreshIceServers() {
  cachedIceServers = [
    {
      urls: [
        'turn:54.210.247.10:3478?transport=udp',
        'turn:54.210.247.10:3478?transport=tcp'
        // if you enabled TLS on 5349, add:
        // 'turns:54.210.247.10:5349?transport=tcp'
      ],
      username: process.env.TURN_USER || 'webrtc',
      credential: process.env.TURN_PASS || 'webrtc'
    }
  ];
  console.log('🔄 ICE servers (only EC2 TURN):', cachedIceServers);
}

// Set once (no need to refresh unless your creds rotate)
refreshIceServers();


// Expose ICE config to clients
app.get('/ice', (req, res) => {
  if (!cachedIceServers.length) {
    return res.status(503).json({ error: 'ICE servers not yet available' });
  }
  res.json({ iceServers: cachedIceServers });
});
// ---------------------------------------

// Create HTTP server (Render will handle TLS)
const server = http.createServer(app);

// Socket.io with CORS set by env var (e.g. your Vercel URL)
const io = new SocketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST']
  }
});

// In-memory signaling state
// Organize offers by room
const rooms = {};
const connectedSockets = [];

// Socket.io logic
io.on('connection', socket => {
  const userName = socket.handshake.auth.userName;
  const password = socket.handshake.auth.password;
  const roomId = socket.handshake.auth.roomId || 'default';

  if (password !== 'x') {
    return socket.disconnect(true);
  }
  
  // Initialize room if it doesn't exist
  if (!rooms[roomId]) {
    rooms[roomId] = {
      offers: [],
      participants: []
    };
  }

  // Add user to room participants
  rooms[roomId].participants.push(userName);
  
  // Track socket connection with room info
  connectedSockets.push({ socketId: socket.id, userName, roomId });
  
  // Join socket.io room
  socket.join(roomId);
  
  // Broadcast updated participant list to everyone in the room
  io.to(roomId).emit('roomParticipants', rooms[roomId].participants);

  // Send any existing offers in this room to newcomers
  if (rooms[roomId].offers.length) {
    socket.emit('availableOffers', rooms[roomId].offers);
  }

  socket.on('newOffer', newOffer => {
    const offerObj = {
      offererUserName: userName,
      offer: newOffer,
      offerIceCandidates: [],
      answererUserName: null,
      answer: null,
      answererIceCandidates: [],
      roomId: roomId
    };
    rooms[roomId].offers.push(offerObj);
    
    // Only broadcast to others in the same room
    socket.to(roomId).emit('newOfferAwaiting', [offerObj]);
  });

  socket.on('newAnswer', (offerObj, ack) => {
    const roomOfferObj = rooms[roomId];
    if (!roomOfferObj) return;
    
    const dest = connectedSockets.find(s => s.userName === offerObj.offererUserName && s.roomId === roomId);
    const offerToUpdate = roomOfferObj.offers.find(o => o.offererUserName === offerObj.offererUserName);
    
    if (!dest || !offerToUpdate) return;

    // Send back any ICE candidates collected so far
    ack(offerToUpdate.offerIceCandidates);

    offerToUpdate.answererUserName = userName;
    offerToUpdate.answer = offerObj.answer;

    socket.to(dest.socketId).emit('answerResponse', offerToUpdate);
  });

  socket.on('sendIceCandidateToSignalingServer', iceObj => {
    const { didIOffer, iceUserName, iceCandidate } = iceObj;
    const roomOffers = rooms[roomId]?.offers;
    if (!roomOffers) return;
    
    if (didIOffer) {
      const offerRec = roomOffers.find(o => o.offererUserName === iceUserName);
      if (!offerRec) return;
      offerRec.offerIceCandidates.push(iceCandidate);
      // Forward to answerer if answered
      if (offerRec.answererUserName) {
        const ansDest = connectedSockets.find(s => s.userName === offerRec.answererUserName && s.roomId === roomId);
        if (ansDest) {
          socket.to(ansDest.socketId).emit('receivedIceCandidateFromServer', iceCandidate);
        }
      }
    } else {
      // ICE from answerer → offerer
      const offerRec = roomOffers.find(o => o.answererUserName === iceUserName);
      if (!offerRec) return;
      const offDest = connectedSockets.find(s => s.userName === offerRec.offererUserName && s.roomId === roomId);
      if (offDest) {
        socket.to(offDest.socketId).emit('receivedIceCandidateFromServer', iceCandidate);
      }
    }
  });

  socket.on('hangup', () => {
    // Only notify users in the same room
    socket.to(roomId).emit('hangup', userName);
    
    // Remove user from room participants
    if (rooms[roomId]) {
      const participantIndex = rooms[roomId].participants.indexOf(userName);
      if (participantIndex !== -1) {
        rooms[roomId].participants.splice(participantIndex, 1);
      }
      
      // Remove any offers made by this user in this room
      const roomOffers = rooms[roomId].offers;
      for (let i = roomOffers.length - 1; i >= 0; i--) {
        if (roomOffers[i].offererUserName === userName) {
          roomOffers.splice(i, 1);
        }
      }
      
      // Broadcast updated offers and participants to room
      io.to(roomId).emit('availableOffers', rooms[roomId].offers);
      io.to(roomId).emit('roomParticipants', rooms[roomId].participants);
      
      // If room is empty, clean it up
      if (rooms[roomId].participants.length === 0) {
        delete rooms[roomId];
      }
    }
    
    // Remove socket from tracking
    const socketIndex = connectedSockets.findIndex(s => s.socketId === socket.id);
    if (socketIndex !== -1) {
      connectedSockets.splice(socketIndex, 1);
    }
  });
  
  // Handle disconnections
  socket.on('disconnect', () => {
    // Clean up the same way as hangup
    if (rooms[roomId]) {
      const participantIndex = rooms[roomId].participants.indexOf(userName);
      if (participantIndex !== -1) {
        rooms[roomId].participants.splice(participantIndex, 1);
      }
      
      // Remove any offers made by this user in this room
      const roomOffers = rooms[roomId].offers;
      for (let i = roomOffers.length - 1; i >= 0; i--) {
        if (roomOffers[i].offererUserName === userName) {
          roomOffers.splice(i, 1);
        }
      }
      
      // Broadcast updated participants to room
      io.to(roomId).emit('roomParticipants', rooms[roomId].participants);
      io.to(roomId).emit('availableOffers', rooms[roomId].offers);
      
      // If room is empty, clean it up
      if (rooms[roomId].participants.length === 0) {
        delete rooms[roomId];
      }
    }
    
    // Remove socket from tracking
    const socketIndex = connectedSockets.findIndex(s => s.socketId === socket.id);
    if (socketIndex !== -1) {
      connectedSockets.splice(socketIndex, 1);
    }
  });

  socket.on('joinThread', async ({ threadId, workspaceId, userName }) => {
    // 1) (Optional) Validate that threadId exists in MongoDB:
    const thread = await Thread.findById(threadId);
    if (!thread) return socket.emit('errorMessage', 'Thread not found');

    // 2) Have this socket join the Socket.IO room:
    socket.join(threadId);

    // 3) (Optional) Broadcast to everyone in that room that someone joined:
    socket.to(threadId).emit('threadUserJoined', {
      threadId,
      userName,
      timestamp: new Date()
    });
  });

  socket.on('sendMessage', async (payload) => {
    try {
      const {
        threadId,
        workspaceId,
        sender,
        content,
        contentType = 'text',
        mediaUrl = ''
      } = payload;

      // 1) Save to MongoDB
      const msg = new Message({
        workspaceId,
        threadId,
        sender,
        content,
        contentType,
        mediaUrl
      });
      await msg.save();

      // 2) Broadcast the _saved_ message to everyone in this thread room
      io.to(threadId).emit('receiveMessage', {
        _id: msg._id,
        workspaceId: msg.workspaceId,
        threadId: msg.threadId,
        sender: msg.sender,
        content: msg.content,
        contentType: msg.contentType,
        mediaUrl: msg.mediaUrl,
        createdAt: msg.createdAt
      });
    } catch (err) {
      console.error('Error saving or broadcasting message:', err);
      socket.emit('errorMessage', 'Failed to save message');
    }
  });

  socket.on('avatarOutput', json => {
    const roomId = socket.handshake.auth.roomId;
    socket.to(roomId).emit('avatarOutput', json);
  });

  socket.on('avatarNavigate', ({ index }) => {
    const roomId = socket.handshake.auth.roomId;
    socket.to(roomId).emit('avatarNavigate', { index });
  });

});

// API endpoint to get active rooms
app.get('/rooms', (req, res) => {
  const activeRooms = Object.keys(rooms).map(roomId => ({
    roomId,
    participantCount: rooms[roomId].participants.length
  }));
  res.json({ rooms: activeRooms });
});

// Listen on the port Render (or local) specifies
const PORT = process.env.PORT || 8181;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server listening on port ${PORT}`);
});
