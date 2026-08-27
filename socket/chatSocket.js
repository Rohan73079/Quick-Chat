/**
 * All real-time chat logic lives here.
 * No database is used — room membership is kept in memory only,
 * so it resets whenever the server restarts.
 */

module.exports = function registerChatHandlers(io) {
  // roomId -> Map<socketId, username>
  const rooms = new Map();

  function getRoomUsers(roomId) {
    if (!rooms.has(roomId)) return [];
    return Array.from(rooms.get(roomId).values());
  }

  function broadcastPresence(roomId) {
    io.to(roomId).emit('room-users', getRoomUsers(roomId));
  }

  io.on('connection', (socket) => {
    // ---- Join or create a room ----
    socket.on('join-room', ({ username, roomId }) => {
      if (!username || !roomId) return;

      socket.data.username = username;
      socket.data.roomId = roomId;
      socket.join(roomId);

      if (!rooms.has(roomId)) rooms.set(roomId, new Map());
      rooms.get(roomId).set(socket.id, username);

      // Tell everyone in the room (including the joiner) who's online
      broadcastPresence(roomId);

      // Tell existing members someone joined
      socket.to(roomId).emit('user-joined', { username });
    });

    // ---- New chat message ----
    socket.on('chat-message', (message) => {
      const { roomId } = socket.data;
      if (!roomId) return;
      // Relay to everyone else in the room
      socket.to(roomId).emit('chat-message', message);
    });

    // ---- Delivery receipt: message physically reached the other client ----
    socket.on('message-delivered', ({ roomId, id }) => {
      if (!roomId || !id) return;
      socket.to(roomId).emit('message-delivered', { id });
    });

    // ---- Read receipt: the other client actually viewed the message ----
    socket.on('message-read', ({ roomId, id }) => {
      if (!roomId || !id) return;
      socket.to(roomId).emit('message-read', { id });
    });

    // ---- Typing indicator ----
    socket.on('typing', () => {
      const { roomId, username } = socket.data;
      if (!roomId) return;
      socket.to(roomId).emit('typing', { username });
    });

    socket.on('stop-typing', () => {
      const { roomId } = socket.data;
      if (!roomId) return;
      socket.to(roomId).emit('stop-typing');
    });

    // ---- Disconnect / leave ----
    socket.on('disconnect', () => {
      const { roomId, username } = socket.data;
      if (!roomId || !rooms.has(roomId)) return;

      rooms.get(roomId).delete(socket.id);
      broadcastPresence(roomId);
      socket.to(roomId).emit('user-left', { username });

      if (rooms.get(roomId).size === 0) {
        rooms.delete(roomId);
      }
    });
  });
};