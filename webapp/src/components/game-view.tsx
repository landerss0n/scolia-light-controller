"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { resetGame, nextPlayer, undoThrow, type GameState } from "@/lib/api";
import { RotateCcw, SkipForward, Undo2, Trophy, Target } from "lucide-react";
import { ThrowPad } from "@/components/throw-pad";

function formatThrow(t: { points: number; multiplier: number; segment: number }) {
  if (t.points === 0) return "Miss";
  if (t.points === 50) return "Bull 50";
  if (t.points === 25 && t.segment === 25) return "Bull 25";
  const prefix = t.multiplier === 3 ? "T" : t.multiplier === 2 ? "D" : "S";
  return `${prefix}${t.segment}`;
}

export function GameView({
  game,
  onReset,
  onUpdate,
}: {
  game: GameState;
  onReset: () => void;
  onUpdate: (state: GameState) => void;
}) {
  async function handleReset() {
    await resetGame();
    onReset();
  }

  async function handleNextPlayer() {
    const state = await nextPlayer();
    onUpdate(state);
  }

  async function handleUndo() {
    try {
      const state = await undoThrow();
      onUpdate(state);
    } catch {
      // Inga kast att ångra
    }
  }

  // Vinnare?
  if (game.winner !== null) {
    const winner = game.players[game.winner];
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12 space-y-6">
            <Trophy className="h-16 w-16 mx-auto text-yellow-500" />
            <h1 className="text-4xl font-bold">{winner.name}</h1>
            <p className="text-xl text-muted-foreground">vinner!</p>
            <Button onClick={handleReset} className="text-lg h-12 px-8">
              <RotateCcw className="h-5 w-5 mr-2" />
              Nytt spel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const turnTotal = game.turnThrows.reduce((s, t) => s + t.points, 0);

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">{game.startScore}</span>
          {game.doubleOut && (
            <Badge variant="secondary">Double Out</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Nytt spel
        </Button>
      </div>

      {/* Spelarkort */}
      <div className="space-y-3">
        {game.players.map((player, i) => {
          const isActive = i === game.currentPlayer;
          return (
            <Card
              key={i}
              className={`transition-all ${
                isActive
                  ? "ring-2 ring-primary shadow-lg"
                  : "opacity-60"
              }`}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-lg">{player.name}</span>
                      {isActive && (
                        <Badge variant="default" className="text-xs">
                          Kastar
                        </Badge>
                      )}
                    </div>
                    {isActive && game.turnThrows.length > 0 && (
                      <div className="flex gap-1">
                        {game.turnThrows.map((t, j) => (
                          <Badge key={j} variant="outline" className="text-xs">
                            {formatThrow(t)}
                          </Badge>
                        ))}
                        {game.turnThrows.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            = {turnTotal}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <span
                    className={`text-4xl font-bold tabular-nums ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {player.score}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Kast i turen */}
      <div className="text-center text-sm text-muted-foreground">
        Kast {game.throwsInTurn} / 3
      </div>

      {/* Knappar */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={handleUndo}
          disabled={game.turnThrows.length === 0}
        >
          <Undo2 className="h-4 w-4 mr-1" />
          Ångra
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={handleNextPlayer}
          disabled={game.players.length <= 1}
        >
          <SkipForward className="h-4 w-4 mr-1" />
          Nästa spelare
        </Button>
      </div>

      {/* Manuellt kast */}
      <ThrowPad />
    </div>
  );
}
