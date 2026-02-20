import { useEffect, useState } from 'react';

function TrackCard({ track, onAdd, onVote, showVotes = false, onRemove }) {
  const [addedAnim, setAddedAnim] = useState(false);

  useEffect(() => {
    return () => {
      setAddedAnim(false);
    };
  }, []);

  const formatDuration = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${seconds.padStart(2, '0')}`;
  };

  const handleAdd = (e) => {
    e.stopPropagation();
    if (!onAdd || addedAnim) return;
    onAdd(track);
    setAddedAnim(true);
    setTimeout(() => setAddedAnim(false), 1200);
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    if (!onRemove) return;
    onRemove(track);
  };

  return (
    <div className="px-2.5 sm:px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <img src={track.image} alt={track.album} className="w-10 h-10 sm:w-11 sm:h-11 rounded-md object-cover shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="text-white text-[13px] sm:text-sm truncate">{track.name}</p>
          <div className="flex items-center gap-1 text-[#8d8d8d] text-[11px] sm:text-xs truncate">
            {track.addedBy && (
              <>
                <span className={track.incognito ? 'text-[#bdbdbd]' : ''}>
                  {track.incognito ? '🕶️ ' : ''}
                  {track.addedBy}
                </span>
                <span>·</span>
              </>
            )}
            <span>{track.artist}</span>
          </div>
        </div>

        <span className="text-[#6f6f6f] text-xs font-mono hidden sm:block">{formatDuration(track.duration_ms)}</span>

        {onAdd && (
          <>
            <button
              onClick={handleAdd}
              disabled={addedAnim}
              aria-label={addedAnim ? 'Added' : 'Add to queue'}
              className={`sm:hidden relative w-8 h-8 rounded-full border transition-all cursor-pointer ${
                addedAnim
                  ? 'border-[#1DB954] bg-[#1DB954] text-black scale-110'
                  : 'border-[#6f6f6f] text-[#e8e8e8] active:scale-95'
              }`}
            >
              <span
                className={`absolute inset-0 flex items-center justify-center text-lg leading-none transition-all ${
                  addedAnim ? 'opacity-0 scale-50' : 'opacity-100 scale-100'
                }`}
              >
                +
              </span>
              <span
                className={`absolute inset-0 flex items-center justify-center text-sm font-bold transition-all ${
                  addedAnim ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
                }`}
              >
                ✓
              </span>
            </button>

            <button
              onClick={handleAdd}
              disabled={addedAnim}
              className={`hidden sm:block opacity-0 group-hover:opacity-100 text-xs font-semibold py-1.5 px-4 rounded-full transition-all cursor-pointer ${
                addedAnim
                  ? 'bg-[#1DB954] text-black'
                  : 'bg-[#1DB954] hover:bg-[#1ed760] text-black'
              }`}
            >
              {addedAnim ? 'Added' : 'Add'}
            </button>
          </>
        )}

        {onRemove && (
          <button
            onClick={handleRemove}
            className="text-[10px] text-[#f7a1aa] bg-[#f15e6c]/10 hover:bg-[#f15e6c]/18 border border-[#f15e6c]/25 px-2 py-1 rounded-md cursor-pointer shrink-0"
          >
            Remove
          </button>
        )}

        {showVotes && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVote(track.id, 1);
              }}
              className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full hover:bg-white/10 text-[#7b7b7b] hover:text-[#1DB954] transition-colors cursor-pointer text-[11px]"
            >
              ▲
            </button>
            <span
              className={`text-[11px] sm:text-xs font-semibold w-4 sm:w-5 text-center font-mono ${
                track.votes > 0 ? 'text-[#1DB954]' : track.votes < 0 ? 'text-[#f15e6c]' : 'text-[#7b7b7b]'
              }`}
            >
              {track.votes}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVote(track.id, -1);
              }}
              className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full hover:bg-white/10 text-[#7b7b7b] hover:text-[#f15e6c] transition-colors cursor-pointer text-[11px]"
            >
              ▼
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TrackCard;
