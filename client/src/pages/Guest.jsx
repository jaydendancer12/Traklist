import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import socket, { API_URL } from '../socket';
import SearchBar from '../components/SearchBar';
import TrackCard from '../components/TrackCard';
import QueueList from '../components/QueueList';
import NowPlayingBar from '../components/NowPlayingBar';

function Guest() {
  const { roomId } = useParams();
  const normalizedRoomId = roomId?.toUpperCase();

  const [results, setResults] = useState([]);
  const [queue, setQueue] = useState([]);
  const [room, setRoom] = useState(null);
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [userName, setUserName] = useState('');
  const [joinState, setJoinState] = useState('form');
  const [incognito, setIncognito] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [guestKey, setGuestKey] = useState('');
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);

  useEffect(() => {
    setAutoJoinAttempted(false);
    setJoinState('form');
  }, [normalizedRoomId]);

  useEffect(() => {
    fetch(`${API_URL}/api/room/${normalizedRoomId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Room not found');
        return res.json();
      })
      .then((data) => {
        setRoom(data);
        setError('');
      })
      .catch(() => setError('Room not found. Check your code and try again.'));
  }, [normalizedRoomId]);

  useEffect(() => {
    const savedGuestKey = window.localStorage.getItem(`traklist_guest_key_${normalizedRoomId}`) || '';
    if (savedGuestKey) setGuestKey(savedGuestKey);
  }, [normalizedRoomId]);

  useEffect(() => {
    if (!room || !guestKey || joinState === 'approved' || autoJoinAttempted) return;

    socket.emit('join_room', {
      roomId: normalizedRoomId,
      userName: userName.trim() || 'Guest',
      isHost: false,
      guestKey,
    });
    setAutoJoinAttempted(true);
  }, [room, guestKey, joinState, normalizedRoomId, userName, autoJoinAttempted]);

  useEffect(() => {
    const onSearchResults = (tracks) => {
      setResults(tracks);
      setSearching(false);
    };

    const onUpdateQueue = (updatedQueue) => setQueue(updatedQueue);
    const onNowPlaying = (track) => setNowPlaying(track || null);

    const onError = (msg) => {
      setMessage(msg);
      setSearching(false);
      setTimeout(() => setMessage(''), 3000);
    };

    const onJoinPending = (msg) => {
      setJoinState('pending');
      setMessage(msg || 'Waiting for host approval...');
    };

    const onJoinApproved = (payload) => {
      if (payload?.guestKey) {
        window.localStorage.setItem(`traklist_guest_key_${normalizedRoomId}`, payload.guestKey);
        setGuestKey(payload.guestKey);
      }
      if (payload?.name) setUserName(payload.name);
      setJoinState('approved');
      setMessage('Approved. You can start queuing songs.');
      setTimeout(() => setMessage(''), 2500);
    };

    const resetJoin = (msg, asError = true) => {
      setJoinState('form');
      setQueue([]);
      setResults([]);
      setSearching(false);
      if (asError) setError(msg);
      else {
        setMessage(msg);
        setTimeout(() => setMessage(''), 2500);
        setError('');
      }
      window.localStorage.removeItem(`traklist_guest_key_${normalizedRoomId}`);
      setGuestKey('');
      setAutoJoinAttempted(false);
    };

    const onJoinRejected = (msg) => resetJoin(msg || 'Host declined your request.');
    const onRemovedByHost = (msg) => resetJoin(msg || 'Host removed you from this session.');
    const onRoomClosed = (msg) => resetJoin(msg || 'This session has ended.');
    const onLeftGroup = (msg) => {
      setLeavingGroup(false);
      resetJoin(msg || 'You left the group.', false);
    };

    socket.on('search_results', onSearchResults);
    socket.on('update_queue', onUpdateQueue);
    socket.on('error_msg', onError);
    socket.on('now_playing', onNowPlaying);
    socket.on('join_pending', onJoinPending);
    socket.on('join_approved', onJoinApproved);
    socket.on('join_rejected', onJoinRejected);
    socket.on('removed_by_host', onRemovedByHost);
    socket.on('room_closed', onRoomClosed);
    socket.on('left_group', onLeftGroup);

    return () => {
      socket.off('search_results', onSearchResults);
      socket.off('update_queue', onUpdateQueue);
      socket.off('error_msg', onError);
      socket.off('now_playing', onNowPlaying);
      socket.off('join_pending', onJoinPending);
      socket.off('join_approved', onJoinApproved);
      socket.off('join_rejected', onJoinRejected);
      socket.off('removed_by_host', onRemovedByHost);
      socket.off('room_closed', onRoomClosed);
      socket.off('left_group', onLeftGroup);
    };
  }, [normalizedRoomId]);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!room) {
      setError('Room not found. Check your code and try again.');
      return;
    }
    if (!userName.trim()) return;

    setError('');
    socket.emit('join_room', {
      roomId: normalizedRoomId,
      userName: userName.trim(),
      isHost: false,
      guestKey,
    });
    setAutoJoinAttempted(true);
  };

  const handleSearch = (query) => {
    if (joinState !== 'approved') return;
    setResults([]);
    setSearching(true);
    socket.emit('search_song', { roomId: normalizedRoomId, query });
  };

  const handleAdd = (track) => {
    socket.emit('add_song', { roomId: normalizedRoomId, track, incognito });
    setMessage(`Added "${track.name}"`);
    setTimeout(() => setMessage(''), 2500);
    setResults((prev) => prev.filter((t) => t.id !== track.id));
  };

  const handleVote = (trackId, direction) => {
    socket.emit('vote_song', { roomId: normalizedRoomId, trackId, direction });
  };

  const handleLeaveGroup = () => {
    if (leavingGroup) return;
    const confirmed = window.confirm('Leave this group? You will need host approval to rejoin.');
    if (!confirmed) return;
    setLeavingGroup(true);
    socket.emit('guest_leave_room', { roomId: normalizedRoomId });
  };

  if (error && !room) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full">
          <p className="text-[#f15e6c] text-base mb-4">{error}</p>
          <a href="/" className="text-[#1DB954] hover:underline text-sm">Go Home</a>
        </div>
      </div>
    );
  }

  if (joinState !== 'approved') {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-white/[0.03] border border-white/[0.08] rounded-3xl p-6"
        >
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black tracking-tight mb-2">
              Trak<span className="text-[#1DB954]">list</span>
            </h1>
            {room && (
              <p className="text-[#bdbdbd] text-sm">
                Join <span className="text-white font-semibold">{room.host.name}</span>'s room
              </p>
            )}
            <p className="text-[#6f6f6f] text-xs mt-1 font-mono tracking-widest">{normalizedRoomId}</p>
          </div>

          {joinState === 'pending' ? (
            <div className="text-center py-4">
              <div className="inline-block w-6 h-6 border-2 border-[#2d2d2d] border-t-[#1DB954] rounded-full animate-spin mb-3" />
              <p className="text-[#d4d4d4] text-sm">Waiting for host approval...</p>
              <button
                onClick={() => {
                  setJoinState('form');
                  setMessage('');
                  setAutoJoinAttempted(false);
                }}
                className="mt-4 text-xs text-[#6f6f6f] hover:text-white cursor-pointer"
              >
                Back
              </button>
            </div>
          ) : (
            <form onSubmit={handleJoin} className="space-y-3">
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Your name"
                maxLength={20}
                autoFocus
                className="w-full bg-black/40 border border-white/[0.08] text-white text-center px-4 py-3.5 rounded-xl outline-none focus:ring-2 focus:ring-[#1DB954]/50 placeholder-[#6a6a6a] text-base sm:text-sm"
              />
              <button
                type="submit"
                disabled={!userName.trim()}
                className="w-full bg-[#1DB954] hover:bg-[#1ed760] disabled:bg-[#2a2a2a] disabled:text-[#777] text-black font-bold py-3.5 rounded-xl text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                Request Access
              </button>
            </form>
          )}

          {error && <p className="text-[#f15e6c] text-xs text-center mt-3">{error}</p>}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="guest-approved-page min-h-screen w-full max-w-full overflow-x-hidden">
      <div className="mobile-shell w-full max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 overflow-x-hidden">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-5 min-w-0 w-full">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight">
              Trak<span className="text-[#1DB954]">list</span>
            </h1>
            {room && (
              <p className="text-[#7f7f7f] text-xs mt-0.5 truncate">
                {room.host.name}'s session · <span className="font-mono">{normalizedRoomId}</span>
              </p>
            )}
          </div>

          <button
            onClick={() => setIncognito((prev) => !prev)}
            className={`self-start sm:self-auto max-w-[64vw] sm:max-w-none truncate px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer border shrink-0 ${
              incognito
                ? 'bg-white/[0.08] border-white/[0.15] text-[#d9d9d9]'
                : 'bg-[#1DB954]/15 border-[#1DB954]/30 text-[#1DB954]'
            }`}
          >
            {incognito ? '🕶️ Incognito' : `👤 ${userName}`}
          </button>
        </div>

        <NowPlayingBar nowPlaying={nowPlaying} role="guest" />

        <SearchBar onSearch={handleSearch} />

        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-[#1DB954]/10 border border-[#1DB954]/20 text-[#1DB954] text-center py-2.5 rounded-xl mb-4 text-xs font-medium"
            >
              {message}
            </motion.div>
          )}
        </AnimatePresence>

        {searching && (
          <div className="text-center py-6">
            <div className="inline-block w-5 h-5 border-2 border-[#2d2d2d] border-t-[#1DB954] rounded-full animate-spin" />
          </div>
        )}

        {results.length > 0 && (
          <div className="mb-7">
            <p className="text-[#bdbdbd] text-xs font-semibold uppercase tracking-wider mb-2.5">Results</p>
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-1.5">
              {results.map((track) => (
                <TrackCard key={track.id} track={track} onAdd={handleAdd} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 w-full min-w-0">
          <QueueList queue={queue} onVote={handleVote} />
        </div>

        <div className="mt-5 pb-2 w-full min-w-0">
          <button
            onClick={handleLeaveGroup}
            disabled={leavingGroup}
            className="w-full bg-[#f15e6c]/10 border border-[#f15e6c]/30 text-[#f7a1aa] hover:bg-[#f15e6c]/16 disabled:opacity-60 text-xs font-semibold px-3 py-2.5 rounded-lg cursor-pointer"
          >
            {leavingGroup ? 'Leaving...' : 'Leave Group'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Guest;
