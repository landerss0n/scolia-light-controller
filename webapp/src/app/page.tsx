"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { SetupForm } from "@/components/setup-form";
import { GameView } from "@/components/game-view";
import { fetchGameState, type GameState } from "@/lib/api";

export default function Home() {
  const [game, setGame] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const state = await fetchGameState();
      setGame(state);
      setConnected(true);
      setError(null);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [poll]);

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="animate-pulse text-2xl">Ansluter till API...</div>
          <p className="text-muted-foreground text-sm">
            Kontrollera att API:t körs på port 3000
          </p>
          {error && (
            <p className="text-destructive text-xs font-mono mt-4">{error}</p>
          )}
        </div>
      </div>
    );
  }

  if (!game?.active) {
    return <SetupForm onGameStarted={(state) => setGame(state)} />;
  }

  return (
    <GameView
      game={game}
      onReset={() => setGame({ ...game, active: false })}
      onUpdate={(state) => setGame(state)}
    />
  );
}
