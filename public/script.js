(() => {
  const socket = io();

  // ---- DOM references ----
  const joinScreen = document.getElementById('join-screen');
  const chatScreen = document.getElementById('chat-screen');
  const joinForm = document.getElementById('join-form');
  const usernameInput = document.getElementById('username');
  const roomIdInput = document.getElementById('roomId');

  const roomTitle = document.getElementById('room-title');
  const roomAvatar = document.getElementById('room-avatar');
  const statusLine = document.getElementById('status-line');
  const messagesEl = document.getElementById('messages');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const clearChatBtn = document.getElementById('clear-chat-btn');
  const leaveBtn = document.getElementById('leave-btn');
  const attachBtn = document.getElementById('attach-btn');
  const fileInput = document.getElementById('file-input');
  const attentionBtn = document.getElementById('attention-btn');

  // ---- State ----
  let username = '';
  let roomId = '';
  let stopTypingTimer = null;
  let hasOtherParticipants = false;
  const pendingReadIds = new Set(); // messages received but not yet marked read
  const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 10MB

  // ==================================================
  // JOIN
  // ==================================================
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    username = usernameInput.value.trim();
    roomId = roomIdInput.value.trim();
    if (!username || !roomId) return;

    socket.emit('join-room', { username, roomId });

    joinScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    roomTitle.textContent = `Room: ${roomId}`;
    roomAvatar.textContent = roomId.charAt(0).toUpperCase();
    setStatus(true);
    messageInput.focus();
  });

  leaveBtn.addEventListener('click', () => {
    window.location.reload();
  });

  // ==================================================
  // PRESENCE / STATUS
  // ==================================================
  function setStatus(online, extraText) {
    statusLine.classList.toggle('online', online);
    statusLine.classList.toggle('offline', !online);
    statusLine.textContent = extraText || (online ? 'Online' : 'Offline');
  }

  socket.on('room-users', (users) => {
    const others = users.filter((u) => u !== username).length;
    hasOtherParticipants = others > 0;
    attentionBtn.classList.toggle('hidden', !hasOtherParticipants);

    if (others > 0) {
      setStatus(true, others === 1 ? 'Online' : `Online (${users.length} in room)`);
    } else {
      setStatus(false, 'Waiting for someone to join...');
    }
  });

  // ==================================================
  // PRIVATE ATTENTION ALERT
  // ==================================================
  attentionBtn.addEventListener('click', async () => {
    if (!hasOtherParticipants) return;

    // Request permission only after a deliberate user action.
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (_) {
        // Some browsers may reject the permission request.
      }
    }

    // Every click is an independent alert. There is intentionally no cooldown.
    socket.emit('attention-alert');
    attentionBtn.classList.add('sent');
    setTimeout(() => attentionBtn.classList.remove('sent'), 180);

  });

  socket.on('attention-alert', () => {
    showAttentionToast();

    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('Attention Required', {
        body: 'You have a new attention alert.',
        // Do not reuse a tag: each click should create a separate notification.
        tag: `quick-chat-attention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        renotify: true,
        silent: false
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  });

  function showAttentionToast() {
    let toast = document.getElementById('attention-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'attention-toast';
      toast.className = 'attention-toast';
      toast.textContent = 'You have a new attention alert.';
      document.body.appendChild(toast);
    }

    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  socket.on('user-joined', ({ username: joinedName }) => {
    addSystemNote(`${escapeHtml(joinedName)} joined the chat`);
  });

  socket.on('user-left', ({ username: leftName }) => {
    addSystemNote(`${escapeHtml(leftName)} left the chat`);
    setStatus(false, 'Waiting for someone to join...');
  });

  socket.on('disconnect', () => setStatus(false, 'Disconnected'));

  // ==================================================
  // SENDING TEXT MESSAGES
  // ==================================================
  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const message = {
      id: generateId(),
      type: 'text',
      sender: username,
      text,
      time: new Date().toISOString()
    };

    renderMessage(message, true);
    socket.emit('chat-message', message);
    socket.emit('stop-typing');
    clearTimeout(stopTypingTimer);

    messageInput.value = '';
    messageInput.focus();
  }

  sendBtn.addEventListener('click', sendMessage);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ---- Typing indicator emission ----
  messageInput.addEventListener('input', () => {
    socket.emit('typing');
    clearTimeout(stopTypingTimer);
    stopTypingTimer = setTimeout(() => {
      socket.emit('stop-typing');
    }, 1200);
  });

  // ==================================================
  // SENDING FILES
  // ==================================================
  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // reset so the same file can be picked again later
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert(`"${file.name}" is too large. Max file size is 1024MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const message = {
        id: generateId(),
        type: 'file',
        sender: username,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        dataUrl: reader.result, // base64 data URL
        time: new Date().toISOString()
      };
      renderMessage(message, true);
      socket.emit('chat-message', message);
    };
    reader.onerror = () => alert('Could not read that file. Please try again.');
    reader.readAsDataURL(file);
  });

  // ==================================================
  // RECEIVING MESSAGES (text or file)
  // ==================================================
  socket.on('chat-message', (message) => {
    renderMessage(message, false);

    // Confirm delivery immediately
    socket.emit('message-delivered', { roomId, id: message.id });

    // Mark as read only if the tab is actually visible/focused
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      socket.emit('message-read', { roomId, id: message.id });
    } else {
      pendingReadIds.add(message.id);
    }
  });

  // When the user comes back to the tab, mark any unread messages as read
  function flushPendingReads() {
    if (document.visibilityState === 'visible' && document.hasFocus() && pendingReadIds.size) {
      pendingReadIds.forEach((id) => {
        socket.emit('message-read', { roomId, id });
      });
      pendingReadIds.clear();
    }
  }
  document.addEventListener('visibilitychange', flushPendingReads);
  window.addEventListener('focus', flushPendingReads);

  // ==================================================
  // TICK UPDATES (sent -> delivered -> read)
  // ==================================================
  socket.on('message-delivered', ({ id }) => {
    const ticksEl = document.querySelector(`[data-msg-id="${id}"] .ticks`);
    if (ticksEl) ticksEl.textContent = '✓✓';
  });

  socket.on('message-read', ({ id }) => {
    const ticksEl = document.querySelector(`[data-msg-id="${id}"] .ticks`);
    if (ticksEl) {
      ticksEl.textContent = '✓✓';
      ticksEl.classList.add('read');
    }
  });

  // ==================================================
  // TYPING INDICATOR DISPLAY
  // ==================================================
  socket.on('typing', ({ username: whoName }) => {
    typingText.textContent = `${whoName} is typing...`;
    typingIndicator.classList.remove('hidden');
  });

  socket.on('stop-typing', () => {
    typingIndicator.classList.add('hidden');
  });

  // ==================================================
  // RENDERING
  // ==================================================
  function renderMessage(message, isOwn) {
    const row = document.createElement('div');
    row.className = `bubble-row ${isOwn ? 'out' : 'in'}`;
    row.dataset.msgId = message.id;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const senderEl = document.createElement('div');
    senderEl.className = 'sender';
    senderEl.textContent = isOwn ? 'You' : message.sender;
    bubble.appendChild(senderEl);

     if (message.type === 'file') {
      bubble.appendChild(buildFileContent(message));
    } else {
      const textEl = document.createElement('div');
      textEl.className = 'text msg-content';
      textEl.dataset.tooltip = isOwn ? username : message.sender;
      textEl.textContent = message.text;
      bubble.appendChild(textEl);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';

    const timeEl = document.createElement('span');
    timeEl.textContent = formatTime(message.time);
    meta.appendChild(timeEl);

    if (isOwn) {
      const ticks = document.createElement('span');
      ticks.className = 'ticks';
      ticks.textContent = '✓'; // sent
      meta.appendChild(ticks);
    }

    bubble.appendChild(meta);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function buildFileContent(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-content';
    wrapper.dataset.tooltip = message.sender;
    const isImage = message.fileType && message.fileType.startsWith('image/');

    if (isImage) {
      const img = document.createElement('img');
      img.className = 'image-preview';
      img.src = message.dataUrl;
      img.alt = message.fileName;
      img.addEventListener('click', () => window.open(message.dataUrl, '_blank'));
      wrapper.appendChild(img);
    } else {
      const link = document.createElement('a');
      link.className = 'file-card';
      link.href = message.dataUrl;
      link.download = message.fileName;

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '📄';
      link.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'file-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'file-name';
      nameEl.textContent = message.fileName;
      info.appendChild(nameEl);

      const sizeEl = document.createElement('span');
      sizeEl.className = 'file-size';
      sizeEl.textContent = formatFileSize(message.fileSize);
      info.appendChild(sizeEl);

      link.appendChild(info);
      wrapper.appendChild(link);
    }

    return wrapper;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function addSystemNote(text) {
    const note = document.createElement('div');
    note.className = 'system-note';
    note.textContent = text;
    messagesEl.appendChild(note);
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================================================
  // CLEAR CHAT (local view only — does not affect the other user)
  // ==================================================
  clearChatBtn.addEventListener('click', () => {
    messagesEl.innerHTML = '';
    addSystemNote('Chat cleared (only visible to you)');
  });
})();