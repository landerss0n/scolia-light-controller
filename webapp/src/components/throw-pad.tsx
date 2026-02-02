"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { simulateThrow } from "@/lib/api";
import { Crosshair, X } from "lucide-react";

const SEGMENTS = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

type Mode = "single" | "double" | "triple";

export function ThrowPad() {
  const [mode, setMode] = useState<Mode>("single");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  async function doThrow(sector: string) {
    setSending(true);
    try {
      await simulateThrow(sector);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        <Crosshair className="h-4 w-4 mr-1" />
        Manuellt kast
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Manuellt kast</CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Multiplier */}
        <div className="flex gap-2">
          {(["single", "double", "triple"] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => setMode(m)}
            >
              {m === "single" ? "Single" : m === "double" ? "Double" : "Triple"}
            </Button>
          ))}
        </div>

        {/* Segment-knappar */}
        <div className="grid grid-cols-5 gap-1.5">
          {SEGMENTS.map((seg) => {
            const prefix = mode === "triple" ? "t" : mode === "double" ? "d" : "s";
            const sector = `${prefix}${seg}`;
            const points = seg * (mode === "triple" ? 3 : mode === "double" ? 2 : 1);
            return (
              <Button
                key={seg}
                variant="outline"
                size="sm"
                className="h-10 text-xs font-mono"
                disabled={sending}
                onClick={() => doThrow(sector)}
              >
                <span className="font-bold">{seg}</span>
                <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">
                  {points}
                </Badge>
              </Button>
            );
          })}
        </div>

        {/* Special */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={sending}
            onClick={() => doThrow("25")}
          >
            Bull 25
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={sending}
            onClick={() => doThrow("50")}
          >
            Bull 50
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            disabled={sending}
            onClick={() => doThrow("None")}
          >
            Miss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
