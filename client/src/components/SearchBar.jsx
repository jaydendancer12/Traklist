import { useState } from 'react';

function SearchBar({ onSearch }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-5">
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a7a7a] text-sm">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tracks"
          className="w-full bg-white/[0.03] border border-white/[0.08] text-white pl-10 pr-4 py-3.5 rounded-xl outline-none focus:ring-2 focus:ring-[#1DB954]/45 placeholder-[#6d6d6d] text-base sm:text-sm"
        />
      </div>
    </form>
  );
}

export default SearchBar;
