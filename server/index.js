const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const querystring = require('querystring');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getRoom(roomId) {
  if (!roomId || typeof roomId !== 'string') return null;
  return rooms.get(roomId.toUpperCase()) || null;
}

function normalizeName(name) {
  const cleaned = String(name || '').trim().slice(0, 20);
  return cleaned || 'Guest';
}

function getRoomUsers(room) {
  const members = room.members || new Map();
  return Array.from(members.values())
    .sort((a, b) => {
      if (a.isHost) return -1;
      if (b.isHost) return 1;
      return a.joinedAt - b.joinedAt;
    })
    .map((user) => ({
      id: user.id,
      name: user.name,
      isHost: user.isHost,
      joinedAt: user.joinedAt,
      online: Boolean(user.online),
    }));
}

function getPendingGuests(room) {
  return Array.from(room.pendingGuests.values()).sort((a, b) => a.requestedAt - b.requestedAt);
}

function generateGuestKey() {
  return crypto.randomBytes(18).toString('base64url');
}

function emitRoomPresence(room) {
  io.to(room.id).emit('update_users', getRoomUsers(room));
  io.to(room.id).emit('pending_guests', getPendingGuests(room));
  const members = room.members || new Map();
  const connectedCount = Array.from(members.values()).filter((member) => member.online).length;
  io.to(room.id).emit('user_count', connectedCount);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableSpotifyStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function exchangeSpotifyAuthCode(code) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await axios.post(
        'https://accounts.spotify.com/api/token',
        querystring.stringify({
          code,
          redirect_uri: process.env.REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:
              'Basic ' +
              Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
          },
        }
      );
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const retryAfterHeader = Number(error?.response?.headers?.['retry-after'] || 0);
      const retryDelay = retryAfterHeader > 0 ? retryAfterHeader * 1000 : 300 * (attempt + 1);

      if (!isRetryableSpotifyStatus(status)) break;
      await sleep(retryDelay);
    }
  }

  throw lastError || new Error('Failed to exchange Spotify auth code');
}

async function fetchSpotifyProfile(accessToken) {
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await axios.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.data) return response.data;
      lastError = new Error('Profile payload missing');
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const retryAfterHeader = Number(error?.response?.headers?.['retry-after'] || 0);
      const retryDelay = retryAfterHeader > 0 ? retryAfterHeader * 1000 : 250 * (attempt + 1);

      if (status === 401 || status === 403 || !isRetryableSpotifyStatus(status)) {
        break;
      }
      await sleep(retryDelay);
    }
  }

  throw lastError || new Error('Failed to load Spotify profile');
}

async function fetchSpotifyProfileName(accessToken) {
  const profile = await fetchSpotifyProfile(accessToken);
  const profileName = profile?.display_name || profile?.id || '';
  if (!profileName) {
    throw new Error('Profile name missing');
  }
  return profileName;
}

async function refreshRoomAccessToken(room) {
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    querystring.stringify({
      grant_type: 'refresh_token',
      refresh_token: room.refreshToken,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      },
    }
  );

  room.accessToken = response.data.access_token;
}

function mapNowPlaying(track) {
  return {
    id: track.id,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    album: track.album?.name,
    image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null,
    uri: track.uri,
    spotify_url: track.external_urls?.spotify || null,
    duration_ms: track.duration_ms,
    preview_url: track.preview_url || null,
  };
}

async function syncNowPlaying(room) {
  if (!room.accessToken || room.syncingNowPlaying) return;
  room.syncingNowPlaying = true;

  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${room.accessToken}` },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 204 || status === 401,
    });

    if (response.status === 204 || !response.data?.item) {
      if (room.nowPlaying !== null) {
        room.nowPlaying = null;
        io.to(room.id).emit('now_playing', null);
      }
      return;
    }

    if (response.status === 401) {
      await refreshRoomAccessToken(room);
      return;
    }

    const mapped = mapNowPlaying(response.data.item);
    const progressMs = response.data.progress_ms || 0;
    const isPlaying = Boolean(response.data.is_playing);

    const nextNowPlaying = {
      ...mapped,
      progress_ms: progressMs,
      is_playing: isPlaying,
      updated_at: Date.now(),
    };

    const prev = room.nowPlaying;
    const changed =
      !prev ||
      prev.id !== nextNowPlaying.id ||
      prev.is_playing !== nextNowPlaying.is_playing ||
      Math.abs((prev.progress_ms || 0) - progressMs) > 1500;

    room.nowPlaying = nextNowPlaying;

    if (changed) {
      io.to(room.id).emit('now_playing', room.nowPlaying);
    }
  } catch (error) {
    console.error(`❌ Now Playing Error [${room.id}]:`, error.response?.data || error.message);
  } finally {
    room.syncingNowPlaying = false;
  }
}

function closeRoom(room, reason = 'Session ended by host.') {
  io.to(room.id).emit('room_closed', reason);

  for (const user of room.users.values()) {
    const userSocket = io.sockets.sockets.get(user.id);
    if (userSocket) {
      userSocket.leave(room.id);
      userSocket.roomId = null;
      userSocket.userName = null;
      userSocket.isHost = false;
      userSocket.memberId = null;
    }
  }

  for (const pending of room.pendingGuests.values()) {
    const pendingSocket = io.sockets.sockets.get(pending.id);
    if (pendingSocket) {
      pendingSocket.pendingRoomId = null;
      pendingSocket.emit('join_rejected', reason);
    }
  }

  rooms.delete(room.id);
  console.log(`🛑 Room ${room.id} closed: ${reason}`);
}

function ensureAuthorizedParticipant(socket, roomId) {
  const room = getRoom(roomId);
  if (!room) {
    socket.emit('error_msg', 'Room not found.');
    return null;
  }

  if (socket.roomId !== room.id || !room.users.has(socket.id)) {
    socket.emit('error_msg', 'You are not approved in this room yet.');
    return null;
  }

  return room;
}

app.get('/login', (req, res) => {
  const scope = [
    'user-read-private',
    'user-read-email',
    'user-modify-playback-state',
    'user-read-playback-state',
    'user-read-currently-playing',
    'streaming',
  ].join(' ');

  const authUrl =
    'https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: process.env.SPOTIFY_CLIENT_ID,
      scope,
      redirect_uri: process.env.REDIRECT_URI,
    });

  res.redirect(authUrl);
});

app.get('/guest-login', (req, res) => {
  const room = getRoom(req.query.roomId);
  if (!room) {
    return res.status(404).send('Room not found.');
  }

  const requestedPath = String(req.query.returnPath || `/guest/${room.id}`);
  const returnPath = requestedPath.startsWith('/guest/') ? requestedPath : `/guest/${room.id}`;

  const state = Buffer.from(
    JSON.stringify({
      mode: 'guest',
      roomId: room.id,
      returnPath,
    })
  ).toString('base64url');

  const authUrl =
    'https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: process.env.SPOTIFY_CLIENT_ID,
      scope: 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state',
      redirect_uri: process.env.REDIRECT_URI,
      state,
    });

  res.redirect(authUrl);
});

app.get('/api/spotify/profile', async (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'Missing Spotify access token.' });
  }

  try {
    const name = await fetchSpotifyProfileName(token);
    return res.json({ name });
  } catch (error) {
    console.error('❌ Spotify profile API error:', error.response?.data || error.message);
    return res.status(502).json({ error: 'Failed to fetch Spotify profile.' });
  }
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const encodedState = req.query.state || '';

  if (!code) {
    return res.status(400).send('No code provided by Spotify.');
  }

  let parsedState = {};
  try {
    if (encodedState) {
      parsedState = JSON.parse(Buffer.from(String(encodedState), 'base64url').toString('utf8'));
    }
  } catch {
    parsedState = {};
  }

  if (parsedState?.mode === 'guest') {
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:5173';
    const returnPath = String(parsedState.returnPath || '/');
    const safeReturnPath = returnPath.startsWith('/guest/') ? returnPath : '/';

    try {
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        querystring.stringify({
          code,
          redirect_uri: process.env.REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:
              'Basic ' +
              Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
          },
        }
      );

      let spotifyProfileName = '';
      try {
        spotifyProfileName = await fetchSpotifyProfileName(tokenResponse.data.access_token);
      } catch (profileErr) {
        console.warn('⚠️ Guest profile lookup failed:', profileErr.response?.data || profileErr.message);
      }

      const nextParams = new URLSearchParams({
        spotify_auth: '1',
        spotify_access_token: tokenResponse.data.access_token,
        spotify_expires_in: String(tokenResponse.data.expires_in || 3600),
      });
      if (spotifyProfileName) {
        nextParams.set('spotify_profile_name', spotifyProfileName);
      }

      return res.redirect(`${baseUrl}${safeReturnPath}?${nextParams.toString()}`);
    } catch (error) {
      console.error('❌ Guest auth callback error:', error.response?.data || error.message);
      return res.redirect(`${baseUrl}${safeReturnPath}?spotify_auth=0`);
    }
  }

  try {
    const tokenResponse = await exchangeSpotifyAuthCode(code);
    let hostName = 'Host';
    let hostImage = null;

    try {
      const profile = await fetchSpotifyProfile(tokenResponse.data.access_token);
      hostName = profile.display_name || profile.id || 'Host';
      hostImage = profile.images?.[0]?.url || null;
    } catch (profileError) {
      console.warn('⚠️ Host profile lookup failed, continuing with fallback host name:', profileError.response?.data || profileError.message);
    }

    const roomId = generateRoomCode();

    rooms.set(roomId, {
      id: roomId,
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
      queue: [],
      approvedGuestKeys: new Map(),
      nowPlaying: null,
      syncingNowPlaying: false,
      users: new Map(),
      members: new Map([
        [
          'HOST',
          {
            id: 'HOST',
            name: hostName,
            isHost: true,
            joinedAt: Date.now(),
            online: false,
            socketId: null,
          },
        ],
      ]),
      pendingGuests: new Map(),
      hostSocketId: null,
      host: {
        name: hostName,
        image: hostImage,
      },
      createdAt: Date.now(),
    });

    console.log(`✅ Room ${roomId} created by ${hostName}`);

    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:5173';
    res.redirect(`${baseUrl}/host/${roomId}`);
  } catch (error) {
    const spotifyError = error.response?.data?.error;
    const spotifyDesc = error.response?.data?.error_description;
    const detail = spotifyDesc || spotifyError || error.message || 'Authentication failed.';
    console.error('❌ Auth Error:', error.response?.data || error.message);
    res.status(500).send(`Authentication failed: ${detail}`);
  }
});

app.get('/api/room/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    id: room.id,
    host: room.host,
    queueLength: room.queue.length,
    userCount: room.users.size,
    pendingCount: room.pendingGuests.size,
    createdAt: room.createdAt,
  });
});

app.get('/api/room/:roomId/queue', (req, res) => {
  const room = getRoom(req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json(room.queue);
});

app.get('/api/room/:roomId/refresh', async (req, res) => {
  const room = getRoom(req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  try {
    await refreshRoomAccessToken(room);
    console.log(`🔄 Token refreshed for room ${room.id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Refresh Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'traklist',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

app.get('/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
      }
    }
  }

  res.json({ ip: localIP });
});

io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  socket.on('join_room', (payload) => {
    const isLegacy = typeof payload === 'string';
    const roomId = isLegacy ? payload : payload?.roomId;
    const room = getRoom(roomId);

    if (!room) {
      socket.emit('error_msg', 'Room not found. Check the code and try again.');
      return;
    }
    if (!room.members) room.members = new Map();
    if (!room.members.has('HOST')) {
      room.members.set('HOST', {
        id: 'HOST',
        name: room.host?.name || 'Host',
        isHost: true,
        joinedAt: room.createdAt || Date.now(),
        online: false,
        socketId: null,
      });
    }

    const isHost = Boolean(!isLegacy && payload?.isHost);
    const userName = normalizeName(isLegacy ? 'Guest' : payload?.userName);
    const guestKey = !isLegacy ? String(payload?.guestKey || '') : '';

    if (isHost) {
      room.hostSocketId = socket.id;
      socket.join(room.id);
      socket.roomId = room.id;
      socket.userName = userName;
      socket.isHost = true;
      socket.memberId = 'HOST';

      room.users.set(socket.id, {
        id: socket.id,
        name: userName,
        isHost: true,
        joinedAt: Date.now(),
      });
      room.members.set('HOST', {
        id: 'HOST',
        name: userName,
        isHost: true,
        joinedAt: room.members.get('HOST')?.joinedAt || Date.now(),
        online: true,
        socketId: socket.id,
      });

      socket.emit('update_queue', room.queue);
      socket.emit('now_playing', room.nowPlaying);
      emitRoomPresence(room);
      io.to(room.id).emit('host_status', { online: true });
      return;
    }

    if (room.users.has(socket.id)) {
      socket.emit('join_approved', { roomId: room.id });
      socket.emit('update_queue', room.queue);
      socket.emit('now_playing', room.nowPlaying);
      return;
    }

    const approved = room.approvedGuestKeys.get(guestKey);
    if (!isHost && approved) {
      const memberId = approved.memberId || guestKey;
      const existingMember = room.members.get(memberId);
      socket.join(room.id);
      socket.roomId = room.id;
      socket.pendingRoomId = null;
      socket.userName = approved.name;
      socket.isHost = false;
      socket.memberId = memberId;

      room.users.set(socket.id, {
        id: socket.id,
        name: approved.name,
        isHost: false,
        joinedAt: Date.now(),
      });
      room.members.set(memberId, {
        id: memberId,
        name: approved.name,
        isHost: false,
        joinedAt: existingMember?.joinedAt || Date.now(),
        online: true,
        socketId: socket.id,
      });

      socket.emit('join_approved', { roomId: room.id, guestKey, name: approved.name });
      socket.emit('update_queue', room.queue);
      socket.emit('now_playing', room.nowPlaying);
      emitRoomPresence(room);
      return;
    }

    room.pendingGuests.set(socket.id, {
      id: socket.id,
      name: userName,
      requestedAt: Date.now(),
    });

    socket.pendingRoomId = room.id;
    socket.userName = userName;
    socket.isHost = false;

    socket.emit('join_pending', 'Waiting for host approval...');
    io.to(room.id).emit('pending_guests', getPendingGuests(room));

    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit('guest_join_request', {
        id: socket.id,
        name: userName,
      });
    }
  });

  socket.on('host_approve_guest', ({ roomId, guestSocketId }) => {
    const room = getRoom(roomId);
    if (!room || room.hostSocketId !== socket.id) return;

    const pending = room.pendingGuests.get(guestSocketId);
    if (!pending) return;

    const guestSocket = io.sockets.sockets.get(guestSocketId);

    room.pendingGuests.delete(guestSocketId);

    if (!guestSocket) {
      emitRoomPresence(room);
      return;
    }

    guestSocket.join(room.id);
    guestSocket.roomId = room.id;
    guestSocket.pendingRoomId = null;
    guestSocket.userName = pending.name;
    guestSocket.isHost = false;

    const approvedGuestKey = generateGuestKey();
    guestSocket.memberId = approvedGuestKey;

    room.users.set(guestSocketId, {
      id: guestSocketId,
      name: pending.name,
      isHost: false,
      joinedAt: Date.now(),
    });
    room.members.set(approvedGuestKey, {
      id: approvedGuestKey,
      name: pending.name,
      isHost: false,
      joinedAt: Date.now(),
      online: true,
      socketId: guestSocketId,
    });
    room.approvedGuestKeys.set(approvedGuestKey, {
      memberId: approvedGuestKey,
      name: pending.name,
      issuedAt: Date.now(),
    });

    guestSocket.emit('join_approved', { roomId: room.id, guestKey: approvedGuestKey, name: pending.name });
    guestSocket.emit('update_queue', room.queue);
    guestSocket.emit('now_playing', room.nowPlaying);

    io.to(room.id).emit('update_queue', room.queue);
    emitRoomPresence(room);
  });

  socket.on('host_reject_guest', ({ roomId, guestSocketId, reason }) => {
    const room = getRoom(roomId);
    if (!room || room.hostSocketId !== socket.id) return;

    const pending = room.pendingGuests.get(guestSocketId);
    if (!pending) return;

    room.pendingGuests.delete(guestSocketId);

    const guestSocket = io.sockets.sockets.get(guestSocketId);
    if (guestSocket) {
      guestSocket.pendingRoomId = null;
      guestSocket.emit('join_rejected', reason || 'Host declined your request.');
    }

    emitRoomPresence(room);
  });

  socket.on('host_remove_member', ({ roomId, guestSocketId }) => {
    const room = getRoom(roomId);
    if (!room || room.hostSocketId !== socket.id) return;

    const member = room.members.get(guestSocketId);
    if (!member || member.isHost) return;

    room.members.delete(guestSocketId);
    for (const [key, value] of room.approvedGuestKeys.entries()) {
      if (value.memberId === guestSocketId) {
        room.approvedGuestKeys.delete(key);
      }
    }

    const guestSocket = member.socketId ? io.sockets.sockets.get(member.socketId) : null;
    if (guestSocket) {
      guestSocket.leave(room.id);
      guestSocket.roomId = null;
      guestSocket.memberId = null;
      room.users.delete(guestSocket.id);
      guestSocket.emit('removed_by_host', 'Host removed you from this session.');
    }

    emitRoomPresence(room);
  });

  socket.on('close_room', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room || room.hostSocketId !== socket.id) return;
    closeRoom(room, 'Host ended the session.');
  });

  socket.on('guest_leave_room', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room || !socket.memberId || socket.memberId === 'HOST') return;

    const member = room.members.get(socket.memberId);
    if (!member || member.isHost) return;

    room.members.delete(socket.memberId);
    for (const [key, value] of room.approvedGuestKeys.entries()) {
      if (value.memberId === socket.memberId) {
        room.approvedGuestKeys.delete(key);
      }
    }

    room.users.delete(socket.id);
    socket.leave(room.id);
    socket.roomId = null;
    socket.memberId = null;
    socket.emit('left_group', 'You left the group.');
    emitRoomPresence(room);
  });

  socket.on('search_song', async ({ roomId, query }) => {
    const room = ensureAuthorizedParticipant(socket, roomId);
    if (!room) return;

    if (!room.accessToken) {
      socket.emit('error_msg', 'Host is not logged in yet.');
      return;
    }

    try {
      const searchResponse = await axios.get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10&market=from_token`,
        { headers: { Authorization: `Bearer ${room.accessToken}` } }
      );

      const items = searchResponse.data.tracks.items || [];
      let previewsByTrackId = new Map();

      const trackIds = items.map((track) => track.id).filter(Boolean);
      if (trackIds.length > 0) {
        try {
          const detailResponse = await axios.get(
            `https://api.spotify.com/v1/tracks?ids=${encodeURIComponent(trackIds.join(','))}&market=from_token`,
            { headers: { Authorization: `Bearer ${room.accessToken}` } }
          );

          previewsByTrackId = new Map(
            (detailResponse.data.tracks || []).map((track) => [track.id, track.preview_url || null])
          );
        } catch (detailErr) {
          console.warn('⚠️ Track detail lookup failed:', detailErr.response?.data || detailErr.message);
        }
      }

      const tracks = items.map((track) => ({
        id: track.id,
        name: track.name,
        artist: track.artists.map((a) => a.name).join(', '),
        album: track.album.name,
        image: track.album.images[1]?.url || track.album.images[0]?.url,
        uri: track.uri,
        duration_ms: track.duration_ms,
        preview_url: previewsByTrackId.get(track.id) || track.preview_url || null,
      }));

      socket.emit('search_results', tracks);
    } catch (err) {
      console.error('❌ Search Error:', err.response?.data || err.message);

      if (err.response?.status === 401) {
        try {
          await refreshRoomAccessToken(room);
          socket.emit('error_msg', 'Session refreshed. Search again.');
        } catch {
          socket.emit('error_msg', 'Session expired. Host needs to re-login.');
        }
      } else {
        socket.emit('error_msg', 'Search failed.');
      }
    }
  });

  socket.on('add_song', async ({ roomId, track, incognito }) => {
    const room = ensureAuthorizedParticipant(socket, roomId);
    if (!room) return;

    if (!room.accessToken) {
      socket.emit('error_msg', 'Host is not logged in yet.');
      return;
    }

    try {
      await axios.post(
        `https://api.spotify.com/v1/me/player/queue?uri=${track.uri}`,
        {},
        { headers: { Authorization: `Bearer ${room.accessToken}` } }
      );

      const queueItem = {
        queueItemId: crypto.randomUUID(),
        ...track,
        addedBy: incognito ? 'Someone' : socket.userName,
        incognito: Boolean(incognito),
        votes: 0,
        addedAt: Date.now(),
      };

      room.queue.push(queueItem);
      io.to(room.id).emit('update_queue', room.queue);
      syncNowPlaying(room);
      console.log(`🎵 [${room.id}] ${socket.userName} added: ${track.name}`);
    } catch (err) {
      console.error('❌ Queue Error:', err.response?.data || err.message);
      socket.emit('error_msg', 'Failed to add song. Is Spotify playing on a device?');
    }
  });

  socket.on('vote_song', ({ roomId, trackId, direction }) => {
    const room = ensureAuthorizedParticipant(socket, roomId);
    if (!room) return;

    const song = room.queue.find((s) => s.id === trackId);
    if (!song) return;

    song.votes += direction;

    if (song.votes <= -3) {
      room.queue = room.queue.filter((s) => s.id !== trackId);
      console.log(`🗑️ [${room.id}] Removed: ${song.name} (too many downvotes)`);
    }

    io.to(room.id).emit('update_queue', room.queue);
  });

  socket.on('host_remove_song', ({ roomId, queueItemId, trackId, addedAt }) => {
    const room = getRoom(roomId);
    if (!room || room.hostSocketId !== socket.id) return;

    const nextQueue = room.queue.filter((song) => {
      if (queueItemId && song.queueItemId) return song.queueItemId !== queueItemId;
      return !(song.id === trackId && Number(song.addedAt) === Number(addedAt));
    });

    if (nextQueue.length === room.queue.length) return;
    room.queue = nextQueue;
    io.to(room.id).emit('update_queue', room.queue);
  });

  socket.on('disconnect', () => {
    if (socket.roomId) {
      const room = getRoom(socket.roomId);

      if (room) {
        if (room.hostSocketId === socket.id) {
          room.hostSocketId = null;
          room.users.delete(socket.id);
          const hostMember = room.members.get('HOST');
          if (hostMember) {
            hostMember.online = false;
            hostMember.socketId = null;
            room.members.set('HOST', hostMember);
          }
          emitRoomPresence(room);
          io.to(room.id).emit('host_status', { online: false });
        } else if (room.users.has(socket.id)) {
          room.users.delete(socket.id);
          if (socket.memberId) {
            const guestMember = room.members.get(socket.memberId);
            if (guestMember) {
              guestMember.online = false;
              guestMember.socketId = null;
              room.members.set(socket.memberId, guestMember);
            }
          }
          emitRoomPresence(room);
        }
      }
    }

    if (socket.pendingRoomId) {
      const room = getRoom(socket.pendingRoomId);
      if (room) {
        room.pendingGuests.delete(socket.id);
        emitRoomPresence(room);
      }
    }

    console.log('🔴 User disconnected:', socket.id);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.users.size > 0) {
      syncNowPlaying(room);
    }
  }
}, 5000);

app.use(express.static(path.join(__dirname, '../client/dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
  console.log(`\n🚀 Traklist server running on port ${PORT}`);
});
