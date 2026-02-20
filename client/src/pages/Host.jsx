import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { motion } from 'framer-motion';
import socket, { API_URL } from '../socket';
import QueueList from '../components/QueueList';
import NowPlayingBar from '../components/NowPlayingBar';

function Host() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const normalizedRoomId = roomId?.toUpperCase();

  const [queue, setQueue] = useState([]);
  const [room, setRoom] = useState(null);
  const [guestUrl, setGuestUrl] = useState('');
  const [userCount, setUserCount] = useState(0);
  const [users, setUsers] = useState([]);
  const [pendingGuests, setPendingGuests] = useState([]);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [copiedField, setCopiedField] = useState('');
  const qrCanvasRef = useRef(null);

  useEffect(() => {
    setGuestUrl(`${window.location.origin}/guest/${normalizedRoomId}`);

    fetch(`${API_URL}/api/room/${normalizedRoomId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Room not found');
        return res.json();
      })
      .then((data) => {
        setRoom(data);
        socket.emit('join_room', {
          roomId: normalizedRoomId,
          userName: data.host.name,
          isHost: true,
        });
      })
      .catch(() => setError('Room not found. It may have expired.'));
  }, [normalizedRoomId]);

  useEffect(() => {
    const onUpdateQueue = (updatedQueue) => setQueue(updatedQueue);
    const onNowPlaying = (track) => setNowPlaying(track || null);
    const onUserCount = (count) => setUserCount(count);
    const onUpdateUsers = (userList) => setUsers(userList);
    const onPendingGuests = (guestList) => setPendingGuests(guestList);
    const onRoomClosed = (msg) => {
      setEnded(true);
      setError(msg || 'Session ended.');
      setTimeout(() => navigate('/'), 1200);
    };
    const onHostStatus = ({ online }) => {
      if (online) {
        setError('');
      } else {
        setError('Host browser disconnected. Room is still live and can be resumed when host reconnects.');
      }
    };

    socket.on('update_queue', onUpdateQueue);
    socket.on('now_playing', onNowPlaying);
    socket.on('user_count', onUserCount);
    socket.on('update_users', onUpdateUsers);
    socket.on('pending_guests', onPendingGuests);
    socket.on('room_closed', onRoomClosed);
    socket.on('host_status', onHostStatus);

    return () => {
      socket.off('update_queue', onUpdateQueue);
      socket.off('now_playing', onNowPlaying);
      socket.off('user_count', onUserCount);
      socket.off('update_users', onUpdateUsers);
      socket.off('pending_guests', onPendingGuests);
      socket.off('room_closed', onRoomClosed);
      socket.off('host_status', onHostStatus);
    };
  }, [navigate]);

  const copyToClipboard = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = value;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      document.execCommand('copy');
      document.body.removeChild(helper);
    }

    setCopiedField(key);
    window.setTimeout(() => {
      setCopiedField((current) => (current === key ? '' : current));
    }, 1400);
  };

  const shareQrCode = async () => {
    if (!guestUrl || !qrCanvasRef.current) return;

    const canvas = qrCanvasRef.current.querySelector('canvas');
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], `traklist-${normalizedRoomId}-qr.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: `Traklist Room ${normalizedRoomId}`,
          text: `Join my Traklist room: ${normalizedRoomId}`,
          url: guestUrl,
          files: [file],
        });
      } catch {
        // User canceled share sheet.
      }
      return;
    }

    await copyToClipboard(guestUrl, 'guest-link');
  };

  const handleVote = (trackId, direction) => {
    socket.emit('vote_song', { roomId: normalizedRoomId, trackId, direction });
  };

  const handleRemoveSong = (track) => {
    socket.emit('host_remove_song', {
      roomId: normalizedRoomId,
      queueItemId: track.queueItemId,
      trackId: track.id,
      addedAt: track.addedAt,
    });
  };

  const approveGuest = (guestSocketId) => {
    socket.emit('host_approve_guest', { roomId: normalizedRoomId, guestSocketId });
  };

  const rejectGuest = (guestSocketId) => {
    socket.emit('host_reject_guest', {
      roomId: normalizedRoomId,
      guestSocketId,
      reason: 'Host declined your request.',
    });
  };

  const removeMember = (guestSocketId) => {
    socket.emit('host_remove_member', { roomId: normalizedRoomId, guestSocketId });
  };

  const endSession = () => {
    const confirmed = window.confirm('End the session for everyone? This cannot be undone.');
    if (!confirmed) return;
    socket.emit('close_room', { roomId: normalizedRoomId });
  };

  if (error && !room) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8">
          <p className="text-[#f15e6c] text-base mb-4">{error}</p>
          <a href="/" className="text-[#1DB954] hover:underline text-sm">Go Home</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center justify-between gap-3 mb-6"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Trak<span className="text-[#1DB954]">list</span>
            </h1>
            {room && <p className="text-[#777] text-sm mt-1">Hosting as {room.host.name}</p>}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => copyToClipboard(normalizedRoomId, 'room-code')}
              className="group bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] px-3 py-1.5 rounded-full text-xs font-mono font-semibold tracking-widest text-[#1DB954] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              aria-label="Copy room code"
            >
              <span>{normalizedRoomId}</span>
              <span className="w-3.5 h-3.5">
                {copiedField === 'room-code' ? (
                  <motion.svg
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    viewBox="0 0 24 24"
                    className="w-3.5 h-3.5 text-[#1ed760]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13.5 9.2 18 19 7" />
                  </motion.svg>
                ) : (
                  <motion.svg
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    viewBox="0 0 24 24"
                    className="w-3.5 h-3.5 text-[#a5e6bd]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="10" height="10" rx="2" />
                    <path d="M5 15V7a2 2 0 0 1 2-2h8" />
                  </motion.svg>
                )}
              </span>
            </button>
            <span className="text-[#a0a0a0] text-xs">{userCount} connected</span>
            <button
              onClick={endSession}
              disabled={ended}
              className="bg-[#f15e6c]/15 hover:bg-[#f15e6c]/25 border border-[#f15e6c]/25 text-[#f7a1aa] text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-60"
            >
              End Party
            </button>
          </div>
        </motion.div>

        {error && room && (
          <div className="mb-4 bg-[#f15e6c]/10 border border-[#f15e6c]/20 text-[#f7a1aa] text-xs rounded-xl p-3">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="space-y-4">
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 text-center">
              <p className="text-[#bdbdbd] text-xs uppercase tracking-wider mb-3">Join Link</p>
              {guestUrl && (
                <>
                  <div className="inline-block bg-white p-3 rounded-xl">
                    <div ref={qrCanvasRef}>
                      <QRCodeCanvas value={guestUrl} size={140} bgColor="#ffffff" fgColor="#000000" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={shareQrCode}
                    className="mt-3 w-full bg-[#1DB954]/15 hover:bg-[#1DB954]/22 border border-[#1DB954]/30 rounded-xl py-2 px-3 text-[#1DB954] text-xs font-semibold cursor-pointer"
                  >
                    Share QR Code
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(guestUrl, 'guest-link')}
                    className="mt-3 w-full bg-black/20 hover:bg-black/35 border border-white/[0.08] rounded-xl py-2 px-2 text-left inline-flex items-center gap-2 transition-colors cursor-pointer"
                    aria-label="Copy guest link"
                  >
                    <span className="text-[#8f8f8f] text-[10px] font-mono break-all flex-1">{guestUrl}</span>
                    <span className="shrink-0 bg-white/[0.04] border border-white/[0.1] rounded-lg p-1.5">
                      {copiedField === 'guest-link' ? (
                        <motion.svg
                          initial={{ scale: 0.7, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          viewBox="0 0 24 24"
                          className="w-4 h-4 text-[#1ed760]"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13.5 9.2 18 19 7" />
                        </motion.svg>
                      ) : (
                        <motion.svg
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          viewBox="0 0 24 24"
                          className="w-4 h-4 text-white"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="9" y="9" width="10" height="10" rx="2" />
                          <path d="M5 15V7a2 2 0 0 1 2-2h8" />
                        </motion.svg>
                      )}
                    </span>
                  </button>
                </>
              )}
            </div>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
              <p className="text-[#bdbdbd] text-xs uppercase tracking-wider mb-3">Join Requests</p>
              {pendingGuests.length === 0 ? (
                <p className="text-[#6f6f6f] text-sm">No pending requests</p>
              ) : (
                <div className="space-y-2.5">
                  {pendingGuests.map((guest) => (
                    <div key={guest.id} className="bg-black/25 rounded-xl p-2.5 border border-white/[0.06]">
                      <p className="text-sm text-white mb-2">{guest.name}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => approveGuest(guest.id)}
                          className="flex-1 bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold py-1.5 rounded-lg cursor-pointer"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => rejectGuest(guest.id)}
                          className="flex-1 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[#d0d0d0] text-xs font-semibold py-1.5 rounded-lg cursor-pointer"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
              <p className="text-[#bdbdbd] text-xs uppercase tracking-wider mb-3">Members</p>
              {users.length === 0 ? (
                <p className="text-[#6f6f6f] text-sm">No one connected</p>
              ) : (
                <div className="space-y-2.5">
                  {users.map((user) => (
                    <div key={user.id} className="flex items-center gap-2.5 bg-black/25 rounded-xl p-2.5 border border-white/[0.06]">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          user.isHost ? 'bg-[#1DB954] text-black' : 'bg-white/10 text-white'
                        }`}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <p className="text-sm text-white flex-1 truncate">{user.name}</p>
                      {user.isHost ? (
                        <span className="text-[10px] text-[#1DB954] font-semibold">{user.online ? 'HOST' : 'HOST OFFLINE'}</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          {!user.online && <span className="text-[10px] text-[#8d8d8d]">offline</span>}
                          <button
                            onClick={() => removeMember(user.id)}
                            className="text-[10px] text-[#f7a1aa] bg-[#f15e6c]/15 border border-[#f15e6c]/20 px-2 py-1 rounded-md cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="xl:col-span-2">
            <NowPlayingBar nowPlaying={nowPlaying} role="host" />
            <QueueList queue={queue} onVote={handleVote} onRemove={handleRemoveSong} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Host;
