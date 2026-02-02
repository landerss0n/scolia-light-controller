"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { startGame, type GameState } from "@/lib/api";
import { Plus, Minus, Target } from "lucide-react";

const SCORE_OPTIONS = [170, 301, 501];

export function SetupForm({
  onGameStarted,
}: {
  onGameStarted: (state: GameState) => void;
}) {
  const [startScore, setStartScore] = useState(501);
  const [customScore, setCustomScore] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [players, setPlayers] = useState(["Spelare 1", "Spelare 2"]);
  const [doubleOut, setDoubleOut] = useState(false);
  const [loading, setLoading] = useState(false);

  function addPlayer() {
    if (players.length < 4) {
      setPlayers([...players, `Spelare ${players.length + 1}`]);
    }
  }

  function removePlayer(index: number) {
    if (players.length > 1) {
      setPlayers(players.filter((_, i) => i !== index));
    }
  }

  function updatePlayer(index: number, name: string) {
    const updated = [...players];
    updated[index] = name;
    setPlayers(updated);
  }

  async function handleStart() {
    setLoading(true);
    try {
      const score = useCustom ? parseInt(customScore) || 501 : startScore;
      const state = await startGame({
        startScore: score,
        players: players.filter((p) => p.trim()),
        doubleOut,
      });
      onGameStarted(state);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Target className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-2xl">Nytt Spel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Startpoäng */}
          <div className="space-y-2">
            <Label>Startpoäng</Label>
            <div className="flex gap-2">
              {SCORE_OPTIONS.map((s) => (
                <Button
                  key={s}
                  variant={!useCustom && startScore === s ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => {
                    setStartScore(s);
                    setUseCustom(false);
                  }}
                >
                  {s}
                </Button>
              ))}
              <Button
                variant={useCustom ? "default" : "outline"}
                className="flex-1"
                onClick={() => setUseCustom(true)}
              >
                Annat
              </Button>
            </div>
            {useCustom && (
              <Input
                type="number"
                placeholder="Ange poäng..."
                value={customScore}
                onChange={(e) => setCustomScore(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          {/* Spelare */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Spelare</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={addPlayer}
                disabled={players.length >= 4}
              >
                <Plus className="h-4 w-4 mr-1" />
                Lägg till
              </Button>
            </div>
            <div className="space-y-2">
              {players.map((player, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={player}
                    onChange={(e) => updatePlayer(i, e.target.value)}
                    placeholder={`Spelare ${i + 1}`}
                  />
                  {players.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removePlayer(i)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Double Out */}
          <div className="flex items-center justify-between">
            <Label htmlFor="double-out">Double Out</Label>
            <Switch
              id="double-out"
              checked={doubleOut}
              onCheckedChange={setDoubleOut}
            />
          </div>

          {/* Starta */}
          <Button
            className="w-full text-lg h-12"
            onClick={handleStart}
            disabled={loading}
          >
            {loading ? "Startar..." : "Starta spel"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
