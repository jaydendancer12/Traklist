import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || window.location.origin;
const socket = io(API_URL);

export default socket;

export { API_URL };