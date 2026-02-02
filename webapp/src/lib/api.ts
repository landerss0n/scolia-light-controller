export interface Player {
  name: string;
  score: number;
}

export interface ThrowData {
  points: number;
  multiplier: number;
  segment: number;
}

export interface GameState {
  active: boolean;
  players: Player[];
  currentPlayer: number;
  throwsInTurn: number;
  turnThrows: ThrowData[];
  startScore: number;
  doubleOut: boolean;
  winner: number | null;
}

const API_BASE = typeof window !== "undefined"
  ? `http://${window.location.hostname}:3000`
  : "http://localhost:3000";

export async function fetchGameState(): Promise<GameState> {
  const res = await fetch(`${API_BASE}/api/game`);
  return res.json();
}

export async function startGame(opts: {
  startScore: number;
  players: string[];
  doubleOut: boolean;
}): Promise<GameState> {
  const res = await fetch(`${API_BASE}/api/game/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return res.json();
}

export async function resetGame(): Promise<void> {
  await fetch(`${API_BASE}/api/game/reset`, { method: "POST" });
}

export async function nextPlayer(): Promise<GameState> {
  const res = await fetch(`${API_BASE}/api/game/next-player`, {
    method: "POST",
  });
  return res.json();
}

export async function undoThrow(): Promise<GameState> {
  const res = await fetch(`${API_BASE}/api/game/undo`, {
    method: "POST",
  });
  return res.json();
}

export async function simulateThrow(sector: string): Promise<GameState> {
  const res = await fetch(`${API_BASE}/api/game/throw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sector }),
  });
  return res.json();
}

export function createEventSource(): EventSource {
  return new EventSource(`${API_BASE}/api/game/events`);
}
