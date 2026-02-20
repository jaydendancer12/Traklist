import { useEffect, useMemo, useRef, useState } from 'react';

function formatTime(ms) {
  if (!ms && ms !== 0) return '--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function NowPlayingBar({ nowPlaying, role, spotifySignedIn = false, spotifyToken = '' }) {
  const [muted, setMuted] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkMessage, setSdkMessage] = useState('');
  const [requiresUserActivation, setRequiresUserActivation] = useState(false);

  const playerRef = useRef(null);
  const deviceIdRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const lastSyncRef = useRef({ trackId: null, targetBucket: -1, wasPlaying: null, deviceId: null });

  const storageKey = useMemo(() => `traklist_muted_${role}`, [role]);
  const shouldUseSdk = role !== 'guest' && spotifySignedIn && Boolean(spotifyToken);

  useEffect(() => {
    const savedMuted = window.localStorage.getItem(storageKey);
    if (savedMuted === '1') setMuted(true);
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, muted ? '1' : '0');
  }, [muted, storageKey]);

  useEffect(() => {
    if (!shouldUseSdk) {
      setSdkReady(false);
      setSdkMessage('');
      return;
    }

    let cancelled = false;

    const initializePlayer = () => {
      if (cancelled || !window.Spotify || playerRef.current) return;

      const player = new window.Spotify.Player({
        name: 'Traklist Room Player',
        getOAuthToken: (cb) => cb(spotifyToken),
        volume: muted ? 0 : 1,
      });

      player.addListener('ready', ({ device_id }) => {
        if (cancelled) return;
        deviceIdRef.current = device_id;
        setSdkReady(true);
        setSdkMessage('');
        setRequiresUserActivation(false);
      });

      player.addListener('not_ready', () => {
        if (cancelled) return;
        setSdkReady(false);
        setSdkMessage('Spotify player is not ready on this device.');
      });

      player.addListener('initialization_error', ({ message }) => {
        if (cancelled) return;
        setSdkMessage(message || 'Spotify player failed to initialize.');
      });

      player.addListener('authentication_error', ({ message }) => {
        if (cancelled) return;
        setSdkMessage(message || 'Spotify authentication failed. Reconnect Spotify.');
      });

      player.addListener('account_error', ({ message }) => {
        if (cancelled) return;
        setSdkMessage(message || 'Spotify account does not support web playback.');
      });

      player.connect();
      playerRef.current = player;
    };

    if (!window.Spotify) {
      const existing = document.getElementById('spotify-player-sdk');
      if (!existing) {
        const script = document.createElement('script');
        script.id = 'spotify-player-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }

      window.onSpotifyWebPlaybackSDKReady = initializePlayer;
    } else {
      initializePlayer();
    }

    return () => {
      cancelled = true;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      deviceIdRef.current = null;
      setSdkReady(false);
    };
  }, [shouldUseSdk, spotifyToken]);

  useEffect(() => {
    if (!playerRef.current) return;
    playerRef.current.setVolume(muted ? 0 : 1);
  }, [muted]);

  const forceActivateAudio = async () => {
    if (!playerRef.current) return;
    try {
      await playerRef.current.activateElement();
      setRequiresUserActivation(false);
      setSdkMessage('');
      lastSyncRef.current = { trackId: null, targetBucket: -1, wasPlaying: null, deviceId: null };
    } catch {
      setSdkMessage('Tap failed. Try unmuting and tap Enable Audio again.');
    }
  };

  useEffect(() => {
    if (!shouldUseSdk || !sdkReady || !deviceIdRef.current || !nowPlaying?.uri || syncInFlightRef.current) return;

    const targetProgress = Math.max(
      0,
      Math.min(
        nowPlaying.duration_ms || 0,
        (nowPlaying.progress_ms || 0) + (nowPlaying.is_playing ? Date.now() - (nowPlaying.updated_at || Date.now()) : 0)
      )
    );
    const targetBucket = Math.floor(targetProgress / 2000);
    const shouldResync =
      lastSyncRef.current.trackId !== nowPlaying.id ||
      lastSyncRef.current.targetBucket !== targetBucket ||
      lastSyncRef.current.wasPlaying !== Boolean(nowPlaying.is_playing) ||
      lastSyncRef.current.deviceId !== deviceIdRef.current;

    if (!shouldResync) return;

    const headers = {
      Authorization: `Bearer ${spotifyToken}`,
      'Content-Type': 'application/json',
    };
    const transferUrl = 'https://api.spotify.com/v1/me/player';
    const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceIdRef.current)}`;
    const pauseUrl = `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceIdRef.current)}`;

    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const syncPlayback = async () => {
      syncInFlightRef.current = true;
      try {
        // Transfer only when device changes; avoids repeated handoffs and jitter.
        if (lastSyncRef.current.deviceId !== deviceIdRef.current) {
          const transferResponse = await fetch(transferUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ device_ids: [deviceIdRef.current], play: false }),
          });

          if (transferResponse.status >= 400) {
            const transferText = await transferResponse.text();
            throw new Error(`Transfer failed (${transferResponse.status}): ${transferText}`);
          }
          await pause(220);
        }

        let playResponse = await fetch(playUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            uris: [nowPlaying.uri],
            position_ms: targetProgress,
          }),
        });

        if (playResponse.status >= 400) {
          await pause(260);
          playResponse = await fetch(playUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              uris: [nowPlaying.uri],
              position_ms: targetProgress,
            }),
          });
        }

        if (playResponse.status >= 400) {
          const playText = await playResponse.text();
          throw new Error(`Play failed (${playResponse.status}): ${playText}`);
        }

        if (!nowPlaying.is_playing) {
          const pauseResponse = await fetch(pauseUrl, { method: 'PUT', headers });
          if (pauseResponse.status >= 400) {
            const pauseText = await pauseResponse.text();
            throw new Error(`Pause failed (${pauseResponse.status}): ${pauseText}`);
          }
        }

        lastSyncRef.current = {
          trackId: nowPlaying.id,
          targetBucket,
          wasPlaying: Boolean(nowPlaying.is_playing),
          deviceId: deviceIdRef.current,
        };
        setSdkMessage('Spotify Sync is live.');
        setRequiresUserActivation(false);
      } catch (err) {
        const text = String(err?.message || '').toLowerCase();
        if (text.includes('autoplay') || text.includes('activate')) {
          setRequiresUserActivation(true);
          setSdkMessage('Browser blocked autoplay. Tap Enable Audio.');
          return;
        }
        if (text.includes('403') || text.includes('premium')) {
          setSdkMessage('Spotify Premium Account Required');
          return;
        }
        setSdkMessage('Spotify Sync had a temporary playback issue. Tap Spotify Sync again.');
      } finally {
        syncInFlightRef.current = false;
      }
    };

    syncPlayback();
  }, [nowPlaying, sdkReady, shouldUseSdk, spotifyToken]);

  const embedTrackId = nowPlaying?.uri?.startsWith('spotify:track:')
    ? nowPlaying.uri.replace('spotify:track:', '')
    : nowPlaying?.id || null;

  if (!nowPlaying) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 mb-4 w-full min-w-0 overflow-hidden">
        <p className="text-xs text-[#828282]">No active playback detected on Spotify yet.</p>
      </div>
    );
  }

  const progress = Math.max(0, Math.min(100, ((nowPlaying.progress_ms || 0) / (nowPlaying.duration_ms || 1)) * 100));

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 mb-4 w-full min-w-0 overflow-hidden">
      <div className="flex items-center gap-3 min-w-0">
        {nowPlaying.image ? (
          <img src={nowPlaying.image} alt={nowPlaying.album || 'Now Playing'} className="w-11 h-11 rounded-md object-cover shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-md bg-white/10 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[#1DB954] font-semibold">Now Playing</p>
          <p className="text-sm text-white truncate">{nowPlaying.name}</p>
          <p className="text-xs text-[#8e8e8e] truncate">{nowPlaying.artist}</p>
        </div>

        <button
          onClick={() => setMuted((prev) => !prev)}
          className="text-[11px] px-2.5 py-1.5 rounded-full border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-white cursor-pointer shrink-0"
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>

      <div className="mt-2.5">
        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-[#1DB954]" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-[#7a7a7a] font-mono">
          <span>{formatTime(nowPlaying.progress_ms || 0)}</span>
          <span>{formatTime(nowPlaying.duration_ms || 0)}</span>
        </div>
      </div>

      {sdkMessage && <p className="mt-2 text-[11px] text-[#f7a1aa]">{sdkMessage}</p>}

      {role !== 'guest' && requiresUserActivation && (
        <button
          onClick={forceActivateAudio}
          className="mt-2 w-full text-xs px-3 py-2 rounded-lg border border-[#1DB954]/30 bg-[#1DB954]/15 text-[#1DB954] cursor-pointer"
        >
          Enable Audio In Browser
        </button>
      )}

      {role !== 'guest' && nowPlaying.spotify_url && (
        <a
          href={nowPlaying.spotify_url}
          target="_blank"
          rel="noreferrer"
          className="inline-block mt-1 text-[11px] text-[#1DB954] hover:underline"
        >
          Open track in Spotify
        </a>
      )}

      {role !== 'guest' && !sdkReady && embedTrackId && (
        <div className="mt-2.5 w-full max-w-full overflow-hidden rounded-xl hidden sm:block">
          <iframe
            src={`https://open.spotify.com/embed/track/${embedTrackId}?utm_source=generator&theme=0`}
            width="100%"
            height="152"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title="Spotify Player"
            style={{ border: 0, display: 'block', maxWidth: '100%', width: '1px', minWidth: '100%' }}
            className="max-w-full"
          />
        </div>
      )}
    </div>
  );
}

export default NowPlayingBar;
