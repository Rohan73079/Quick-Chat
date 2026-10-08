// const express = require('express');
// const http = require('http');
// const path = require('path');
// const { Server } = require('socket.io');
// const registerChatHandlers = require('./socket/chatSocket');

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: { origin: '*' }
// });

// // Serve static frontend
// app.use(express.static(path.join(__dirname, 'public')));

// // Register all socket.io event handlers
// registerChatHandlers(io);

// const PORT = process.env.PORT || 3000;
// server.listen(PORT,"0.0.0.0", () => {
//   console.log(`✅ Chat server running at http://localhost:${PORT}`);
// });

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const registerChatHandlers = require('./socket/chatSocket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 12 * 1024 * 1024 // allow file attachments up to ~10MB (base64 overhead included)
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Register all socket.io event handlers
registerChatHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Chat server running at http://localhost:${PORT}`);
});