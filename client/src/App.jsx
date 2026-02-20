import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import Host from './pages/Host';
import Guest from './pages/Guest';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[#060607] text-white overflow-x-hidden">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/host/:roomId" element={<Host />} />
          <Route path="/guest/:roomId" element={<Guest />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
