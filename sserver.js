const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data storage (JSON files para simple)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DB = {
  users: path.join(DATA_DIR, 'users.json'),
  tutors: path.join(DATA_DIR, 'tutors.json'),
  bookings: path.join(DATA_DIR, 'bookings.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  messages: path.join(DATA_DIR, 'messages.json')
};

// Helper functions
function readDB(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeDB(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Initialize empty DBs
Object.values(DB).forEach(file => {
  if (!fs.existsSync(file)) writeDB(file, []);
});

// ============== AUTH ROUTES ==============
app.post('/api/register', (req, res) => {
  const { name, studentId, email, password, course, year } = req.body;
  
  const users = readDB(DB.users);
  if (users.find(u => u.email === email || u.studentId === studentId)) {
    return res.status(400).json({ error: 'Email or Student ID already exists' });
  }

  const user = {
    id: Date.now().toString(),
    name, studentId, email, password, course, year,
    balance: 5,
    createdAt: new Date().toISOString()
  };
  
  users.push(user);
  writeDB(DB.users, users);
  
  res.json({ success: true, user: { ...user, password: undefined } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const users = readDB(DB.users);
  const user = users.find(u => (u.email === email || u.studentId === email) && u.password === password);
  
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  res.json({ success: true, user: { ...user, password: undefined } });
});

app.get('/api/user/:id', (req, res) => {
  const users = readDB(DB.users);
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  res.json({ ...user, password: undefined });
});

app.put('/api/user/:id', (req, res) => {
  const users = readDB(DB.users);
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  
  users[idx] = { ...users[idx], ...req.body };
  writeDB(DB.users, users);
  
  res.json({ success: true, user: { ...users[idx], password: undefined } });
});

// ============== TUTOR ROUTES ==============
app.get('/api/tutors', (req, res) => {
  const tutors = readDB(DB.tutors);
  const users = readDB(DB.users);
  
  const tutorsWithInfo = tutors.map(t => {
    const user = users.find(u => u.id === t.userId);
    return { ...t, ...user, password: undefined };
  });
  
  res.json(tutorsWithInfo);
});

app.post('/api/tutor', (req, res) => {
  const tutors = readDB(DB.tutors);
  const existingIdx = tutors.findIndex(t => t.userId === req.body.userId);
  
  if (existingIdx !== -1) {
    tutors[existingIdx] = { ...tutors[existingIdx], ...req.body };
  } else {
    tutors.push(req.body);
  }
  
  writeDB(DB.tutors, tutors);
  res.json({ success: true });
});

// ============== BOOKING ROUTES ==============
app.get('/api/bookings/:userId', (req, res) => {
  const bookings = readDB(DB.bookings);
  const userBookings = bookings.filter(b => 
    b.studentId === req.params.userId || b.tutorId === req.params.userId
  );
  res.json(userBookings);
});

app.post('/api/booking', (req, res) => {
  const bookings = readDB(DB.bookings);
  const booking = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() };
  bookings.push(booking);
  writeDB(DB.bookings, bookings);
  
  // Update user balance
  const users = readDB(DB.users);
  const studentIdx = users.findIndex(u => u.id === booking.studentId);
  if (studentIdx !== -1) {
    users[studentIdx].balance -= booking.rate;
    writeDB(DB.users, users);
  }
  
  res.json({ success: true, booking });
});

app.put('/api/booking/:id', (req, res) => {
  const bookings = readDB(DB.bookings);
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  
  bookings[idx] = { ...bookings[idx], ...req.body };
  writeDB(DB.bookings, bookings);
  
  res.json({ success: true, booking: bookings[idx] });
});

app.delete('/api/booking/:id', (req, res) => {
  let bookings = readDB(DB.bookings);
  const booking = bookings.find(b => b.id === req.params.id);
  
  if (booking) {
    // Refund if declined
    const users = readDB(DB.users);
    const studentIdx = users.findIndex(u => u.id === booking.studentId);
    if (studentIdx !== -1) {
      users[studentIdx].balance += booking.rate;
      writeDB(DB.users, users);
    }
  }
  
  bookings = bookings.filter(b => b.id !== req.params.id);
  writeDB(DB.bookings, bookings);
  
  res.json({ success: true });
});

// ============== SESSION HISTORY ==============
app.get('/api/history/:userId', (req, res) => {
  const history = readDB(DB.sessions);
  const userHistory = history.filter(h => 
    h.studentId === req.params.userId || h.tutorId === req.params.userId
  );
  res.json(userHistory.reverse());
});

app.post('/api/history', (req, res) => {
  const history = readDB(DB.sessions);
  history.push(req.body);
  writeDB(DB.sessions, history);
  res.json({ success: true });
});

// ============== MESSAGES/CHAT ==============
app.get('/api/messages/:bookingId', (req, res) => {
  const messages = readDB(DB.messages);
  const bookingMessages = messages.filter(m => m.bookingId === req.params.bookingId);
  res.json(bookingMessages);
});

app.post('/api/messages', (req, res) => {
  const messages = readDB(DB.messages);
  messages.push(req.body);
  writeDB(DB.messages, messages);
  res.json({ success: true });
});

// ============== SOCKET.IO FOR REAL-TIME ==============
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join video call room
  socket.on('join-room', ({ roomId, userId, userName }) => {
    socket.join(roomId);
    socket.userId = userId;
    socket.userName = userName;
    socket.roomId = roomId;
    
    if (!activeRooms.has(roomId)) {
      activeRooms.set(roomId, new Set());
    }
    activeRooms.get(roomId).add({ userId, userName, socketId: socket.id });
    
    // Notify others in room
    socket.to(roomId).emit('user-joined', { userId, userName });
    
    // Send existing participants
    const participants = Array.from(activeRooms.get(roomId)).filter(p => p.userId !== userId);
    socket.emit('existing-participants', participants);
    
    console.log(`${userName} joined room ${roomId}`);
  });

  // WebRTC signaling
  socket.on('offer', ({ target, offer }) => {
    io.to(target).emit('offer', { sender: socket.id, offer });
  });

  socket.on('answer', ({ target, answer }) => {
    io.to(target).emit('answer', { sender: socket.id, answer });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('ice-candidate', { sender: socket.id, candidate });
  });

  // Chat messages
  socket.on('chat-message', (data) => {
    const { roomId } = data;
    io.to(roomId).emit('chat-message', data);
    
    // Save to DB
    const messages = readDB(DB.messages);
    messages.push({
      bookingId: roomId,
      senderId: data.senderId,
      senderName: data.senderName,
      text: data.text,
      time: new Date().toISOString()
    });
    writeDB(DB.messages, messages);
  });

  // Screen share status
  socket.on('screen-share', ({ roomId, isSharing }) => {
    socket.to(roomId).emit('peer-screen-share', { userId: socket.userId, isSharing });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.roomId && activeRooms.has(socket.roomId)) {
      activeRooms.get(socket.roomId).delete(socket.userId);
      if (activeRooms.get(socket.roomId).size === 0) {
        activeRooms.delete(socket.roomId);
      } else {
        socket.to(socket.roomId).emit('user-left', { userId: socket.userId });
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`PLSP Time-Bank Server running on port ${PORT}`);
});

