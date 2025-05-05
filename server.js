// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const axios = require('axios');
const http = require('http');
const socketio = require('socket.io');

const app = express();

// Health check for Render
app.get('/healthz', (req, res) => res.send('OK'));

// Serve static client files from public/
app.use(express.static(path.join(__dirname, 'public')));

// --- ICE SERVERS CACHING (via Xirsys) ---
let cachedIceServers = [];

async function refreshIceServers() {
  try {
    // 1. Make a PUT to the Xirsys _turn endpoint (no ?format parameter)
    const response = await axios.put(
      process.env.XIRSYS_ENDPOINT,
      {}, // empty body
      {
        auth: {
          username: process.env.XIRSYS_IDENT,
          password: process.env.XIRSYS_SECRET
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data;
    // 2. Pull out the ICE servers array
    const servers = data.v?.iceServers
                  || data.d?.iceServers
                  || data.iceServers
                  || [];
    if (!servers.length) {
      console.error('❌ No iceServers array in Xirsys response:', data);
      return;
    }

    cachedIceServers = servers;
    console.log('🔄 ICE servers refreshed:', cachedIceServers);

  } catch (err) {
    console.error('❌ Error fetching ICE servers:', err.message);
  }
}

// Initial fetch and periodic refresh every hour
refreshIceServers();
setInterval(refreshIceServers, 1000 * 60 * 60);

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
const io = socketio(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// In-memory signaling state
const offers = [];
const connectedSockets = [];

// Socket.io logic
io.on('connection', socket => {
  const userName = socket.handshake.auth.userName;
  const password = socket.handshake.auth.password;

  if (password !== 'x') {
    return socket.disconnect(true);
  }

  connectedSockets.push({ socketId: socket.id, userName });

  // Send any existing offers to newcomers
  if (offers.length) {
    socket.emit('availableOffers', offers);
  }

  socket.on('newOffer', newOffer => {
    offers.push({
      offererUserName: userName,
      offer: newOffer,
      offerIceCandidates: [],
      answererUserName: null,
      answer: null,
      answererIceCandidates: []
    });
    socket.broadcast.emit('newOfferAwaiting', offers.slice(-1));
  });

  socket.on('newAnswer', (offerObj, ack) => {
    const dest = connectedSockets.find(s => s.userName === offerObj.offererUserName);
    const offerToUpdate = offers.find(o => o.offererUserName === offerObj.offererUserName);
    if (!dest || !offerToUpdate) return;

    // Send back any ICE candidates collected so far
    ack(offerToUpdate.offerIceCandidates);

    offerToUpdate.answererUserName = userName;
    offerToUpdate.answer = offerObj.answer;

    socket.to(dest.socketId).emit('answerResponse', offerToUpdate);
  });

  socket.on('sendIceCandidateToSignalingServer', iceObj => {
    const { didIOffer, iceUserName, iceCandidate } = iceObj;
    if (didIOffer) {
      const offerRec = offers.find(o => o.offererUserName === iceUserName);
      if (!offerRec) return;
      offerRec.offerIceCandidates.push(iceCandidate);
      // Forward to answerer if answered
      if (offerRec.answererUserName) {
        const ansDest = connectedSockets.find(s => s.userName === offerRec.answererUserName);
        if (ansDest) {
          socket.to(ansDest.socketId).emit('receivedIceCandidateFromServer', iceCandidate);
        }
      }
    } else {
      // ICE from answerer → offerer
      const offerRec = offers.find(o => o.answererUserName === iceUserName);
      if (!offerRec) return;
      const offDest = connectedSockets.find(s => s.userName === offerRec.offererUserName);
      if (offDest) {
        socket.to(offDest.socketId).emit('receivedIceCandidateFromServer', iceCandidate);
      }
    }
  });
});

// Listen on the port Render (or local) specifies
const PORT = process.env.PORT || 8181;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server listening on port ${PORT}`);
});