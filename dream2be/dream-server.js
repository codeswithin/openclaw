const express = require('express');
const https = require('https');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());

const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/api.dream2be.emyx.us/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/api.dream2be.emyx.us/fullchain.pem')
};

const dreamHistory = [];
const MAX_DREAMS = 200;
let dreamIdCounter = 0;
const startTime = Date.now();
const connectedPeers = new Map();

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Dream2be server running', totalDreams: dreamHistory.length, connectedPeers: connectedPeers.size });
});
app.get('/time', (req, res) => {
  res.json({ now: Date.now() });
});
app.get('/dreams', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  res.json({ success: true, dreams: dreamHistory.filter(d => d.id > since) });
});

const server = https.createServer(sslOptions, app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

io.on('connection', (socket) => {
  console.log('🔌', socket.id);
  socket.on('identify', (role) => {
    connectedPeers.set(socket.id, { id: socket.id, role, joinedAt: Date.now() });
    io.emit('stats', {
      presenters: [...connectedPeers.values()].filter(p => p.role === 'presenter').length,
      submitters: [...connectedPeers.values()].filter(p => p.role === 'submitter').length
    });
  });
  socket.on('dream', (data) => {
    const dream = { id: ++dreamIdCounter, text: (data.text || '').trim().split(/\s+/).filter(w => w.length > 0).slice(0, 20).join(' '), emoji: data.emoji || '✨', timestamp: Date.now(), votes: 0 };
    if (!dream.text) return;
    dreamHistory.push(dream);
    if (dreamHistory.length > MAX_DREAMS) dreamHistory.shift();
    io.emit('new-dream', dream);
  });

  socket.on('vote', (data) => {
    const dream = dreamHistory.find(d => d.id === data.id);
    if (dream) {
      dream.votes = (dream.votes || 0) + 1;
      io.emit('vote-update', { id: dream.id, votes: dream.votes });
    }
  });
  socket.on('disconnect', () => {
    connectedPeers.delete(socket.id);
    io.emit('stats', { presenters: 0, submitters: 0 });
  });
});

const PORT = process.env.HTTPS_PORT || 3003;
server.listen(PORT, '0.0.0.0', () => console.log(`✨ Dream2be server on port ${PORT}`));
