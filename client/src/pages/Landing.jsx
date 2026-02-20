import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_URL } from '../socket';

function Landing() {
  const [joinCode, setJoinCode] = useState('');
  const navigate = useNavigate();

  const handleLogin = () => {
    window.location.href = `${API_URL}/login`;
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (joinCode.trim()) {
      navigate(`/guest/${joinCode.trim().toUpperCase()}`);
    }
  };

  return (
    <div className="relative flex items-center justify-center min-h-screen px-6 overflow-hidden">
      <div className="absolute top-[-180px] left-[-120px] w-[460px] h-[460px] rounded-full bg-[#1DB954]/15 blur-[120px]" />
      <div className="absolute bottom-[-200px] right-[-140px] w-[520px] h-[520px] rounded-full bg-[#2dd4bf]/10 blur-[140px]" />

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-md bg-white/[0.03] border border-white/[0.08] rounded-3xl p-7 sm:p-9 backdrop-blur-sm"
      >
        <div className="text-center mb-10">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#1DB954]/15 mb-4">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5 fill-[#1DB954]">
              <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.8-1.72-6.33-2.1-10.47-1.13a.75.75 0 1 1-.34-1.46c4.54-1.06 8.45-.62 11.6 1.3.35.22.46.68.24 1.04Zm1.47-2.92a.94.94 0 0 1-1.28.31c-3.21-1.98-8.1-2.56-11.9-1.41a.94.94 0 0 1-.54-1.8c4.33-1.31 9.73-.66 13.42 1.61.44.27.58.85.3 1.29Zm.13-3.06c-3.85-2.28-10.2-2.49-13.88-1.37a1.12 1.12 0 0 1-.66-2.14c4.24-1.29 11.3-1.04 15.7 1.56a1.12 1.12 0 0 1-1.16 1.95Z" />
            </svg>
          </span>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight mb-2">
            Trak<span className="text-[#1DB954]">list</span>
          </h1>
          <p className="text-[#adadad] text-sm">Private room links. Crowd-powered queue.</p>
        </div>

        <button
          onClick={handleLogin}
          className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-3.5 rounded-xl text-sm transition-colors cursor-pointer"
        >
          Host a Session
        </button>

        <div className="flex items-center gap-4 my-7">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[#6f6f6f] text-xs uppercase tracking-widest">or join room</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <form onSubmit={handleJoin} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={6}
            className="flex-1 bg-black/35 border border-white/[0.08] text-white text-center tracking-[0.24em] font-mono font-semibold px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-[#1DB954]/50 placeholder-[#676767] text-base sm:text-sm"
          />
          <button
            type="submit"
            className="hidden sm:block bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white font-semibold px-5 py-3 rounded-xl transition-colors cursor-pointer text-sm"
          >
            Join
          </button>
          <button
            type="submit"
            className="sm:hidden bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white font-semibold px-5 py-3 rounded-xl transition-colors cursor-pointer text-sm"
          >
            Join
          </button>
        </form>
      </motion.div>
    </div>
  );
}

export default Landing;
