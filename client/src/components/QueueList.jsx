import TrackCard from './TrackCard';

function QueueList({ queue, onVote, onRemove }) {
  if (queue.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-10 text-center backdrop-blur-sm">
        <p className="text-[#c0c0c0] text-sm">No songs in the queue yet.</p>
        <p className="text-[#6f6f6f] text-xs mt-1">Guests can add tracks once host approves them.</p>
      </div>
    );
  }

  const sorted = [...queue].sort((a, b) => b.votes - a.votes || a.addedAt - b.addedAt);

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 backdrop-blur-sm min-w-0 overflow-hidden">
      <div className="flex items-center justify-between mb-2.5 px-3">
        <p className="text-[#bdbdbd] text-xs font-semibold uppercase tracking-wider">Queue</p>
        <p className="text-[#6f6f6f] text-xs">{queue.length} {queue.length === 1 ? 'track' : 'tracks'}</p>
      </div>
      <div>
        {sorted.map((track) => (
          <TrackCard
            key={track.queueItemId || `${track.id}-${track.addedAt}`}
            track={track}
            onVote={onVote}
            showVotes={true}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

export default QueueList;
