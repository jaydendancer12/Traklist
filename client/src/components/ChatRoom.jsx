import { useMemo, useState } from 'react';

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ChatRoom({ messages, onSend, currentUser }) {
  const [draft, setDraft] = useState('');

  const sorted = useMemo(() => [...messages].sort((a, b) => a.createdAt - b.createdAt), [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  };

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 w-full min-w-0 overflow-hidden">
      <p className="text-[#bdbdbd] text-xs font-semibold uppercase tracking-wider mb-2">Room Chat</p>

      <div className="max-h-52 overflow-y-auto pr-1 space-y-2 mb-3">
        {sorted.length === 0 ? (
          <p className="text-xs text-[#787878]">No messages yet.</p>
        ) : (
          sorted.map((msg) => {
            if (msg.system) {
              return (
                <p key={msg.id} className="text-[11px] text-[#7d7d7d] text-center">
                  {msg.message}
                </p>
              );
            }

            const mine = msg.sender === currentUser;
            return (
              <div key={msg.id} className={`rounded-xl p-2 ${mine ? 'bg-[#1DB954]/14' : 'bg-black/25 border border-white/[0.06]'}`}>
                <div className="flex items-center justify-between gap-2 mb-0.5 min-w-0">
                  <p className={`text-[11px] font-semibold truncate ${msg.isHost ? 'text-[#1DB954]' : 'text-[#d0d0d0]'}`}>
                    {msg.sender}
                  </p>
                  <span className="text-[10px] text-[#7a7a7a] shrink-0">{formatTime(msg.createdAt)}</span>
                </div>
                <p className="text-xs text-white break-words">{msg.message}</p>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 min-w-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={280}
          placeholder="Message the room"
          className="flex-1 min-w-0 bg-black/35 border border-white/[0.08] text-white px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-[#1DB954]/45 text-xs"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="px-3 py-2 rounded-lg bg-[#1DB954] text-black text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatRoom;
