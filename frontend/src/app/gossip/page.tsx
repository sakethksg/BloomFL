"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { NodeState } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/useWebSocket";
import { IconNetwork, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

interface GraphNode {
  id: string;
  peers: number;
  x?: number;
  y?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  latency: number;
  bytes: number;
  success: boolean;
  round: number;
}

// Simple force-layout canvas graph base resolution
const CANVAS_W = 900;
const CANVAS_H = 420;

function GossipCanvas({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = CANVAS_W;
  const height = CANVAS_H;

  // Place nodes in a circle
  const positions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(cx, cy) * 0.58;
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      map[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
    return map;
  }, [nodes, width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    // Get the actual rendered size to prevent blurriness
    const rect = canvas.getBoundingClientRect();
    
    // Scale internal resolution to match CSS layout size exactly
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    // Calculate scaling factor to keep hardcoded coordinates working
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    ctx.scale(dpr * scaleX, dpr * scaleY);

    ctx.clearRect(0, 0, width, height);

    // Draw edges with glow
    for (const edge of edges) {
      const s = positions[edge.source];
      const t = positions[edge.target];
      if (!s || !t) continue;

      const color = edge.success ? "#10b981" : "#ef4444";
      const lw = Math.max(1.5, Math.min(5, edge.bytes / 1024 / 300));

      // glow pass
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw + 6;
      ctx.globalAlpha = 0.08;
      ctx.stroke();

      // main line
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.globalAlpha = 0.75;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw nodes
    const RADIUS = 34;
    for (const node of nodes) {
      const pos = positions[node.id];
      if (!pos) continue;

      // Outer glow (Dark green theme)
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, RADIUS + 8, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(21, 128, 61, 0.18)"; 
      ctx.fill();

      // Gradient fill (Dark green theme)
      const grad = ctx.createRadialGradient(pos.x - RADIUS * 0.3, pos.y - RADIUS * 0.3, 2, pos.x, pos.y, RADIUS);
      grad.addColorStop(0, "#22c55e"); // Lighter green for highlight/depth
      grad.addColorStop(1, "#14532d"); // Dark green base
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.fill();

      // White ring
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Label
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = node.id.length > 8 ? node.id.slice(-8) : node.id;
      ctx.fillText(label, pos.x, pos.y);
    }
  }, [positions, edges, nodes, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full"
      style={{ width: "100%", aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
    />
  );
}

export default function GossipPage() {
  const [allHistory, setAllHistory] = useState<Record<string, NodeState[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(true);
  const [round, setRound] = useState(0);
  const [maxRound, setMaxRound] = useState(0);

  const loadHistory = useCallback(async () => {
    try {
      const nodes = await api.nodes.list();
      const entries = await Promise.all(
        nodes.map((n) =>
          api.nodes.history(n.node_id).then((h) => [n.node_id, h] as const)
        )
      );
      const history = Object.fromEntries(entries);
      setAllHistory(history);
      const max = Math.max(
        0,
        ...Object.values(history).flatMap((recs) => recs.map((r) => r.round))
      );
      setMaxRound(max);
      if (liveMode) setRound(max);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gossip data");
    } finally {
      setLoading(false);
    }
  }, [liveMode]);

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 5000);
    return () => clearInterval(interval);
  }, [loadHistory]);

  // Live updates via WS
  const handleLive = useCallback(
    (data: NodeState) => {
      setAllHistory((prev) => {
        const updated = { ...prev };
        const existing = updated[data.node_id] ?? [];
        const last = existing[existing.length - 1];
        if (!last || last.round !== data.round) {
          updated[data.node_id] = [...existing, data];
        }
        return updated;
      });
      if (liveMode) {
        setRound((r) => Math.max(r, data.round));
        setMaxRound((m) => Math.max(m, data.round));
      }
    },
    [liveMode]
  );

  useWebSocket<NodeState>("nodes", handleLive);

  // Build graph for selected round
  const { graphNodes, graphEdges } = useMemo(() => {
    const gnodes: GraphNode[] = [];
    const gedges: GraphEdge[] = [];
    const seen = new Set<string>();

    for (const [nodeId, recs] of Object.entries(allHistory)) {
      const rec = recs.find((r) => r.round === round);
      if (!rec) continue;

      if (!seen.has(nodeId)) {
        gnodes.push({ id: nodeId, peers: rec.peer_count });
        seen.add(nodeId);
      }

      if (rec.gossip_peer) {
        gedges.push({
          source: nodeId,
          target: rec.gossip_peer,
          latency: rec.gossip_latency_ms ?? 0,
          bytes: rec.bytes_exchanged ?? 0,
          success: !!rec.gossip_success,
          round: rec.round,
        });
      }
    }
    return { graphNodes: gnodes, graphEdges: gedges };
  }, [allHistory, round]);

  if (loading) {
    return (
      <div className="space-y-6 px-4 lg:px-6 py-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 lg:px-6 py-6">
        <Card className="border-2 border-destructive/30">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="rounded-full bg-destructive/10 p-4">
                <IconNetwork className="size-8 text-destructive" />
              </div>
              <p className="text-lg font-semibold">Failed to load gossip data</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <p className="text-xs text-muted-foreground">Make sure the backend is running and try again.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <IconNetwork className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Gossip Graph</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Visualize peer-to-peer model exchanges — green edges indicate successful transfers, red indicates failures.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Live toggle */}
            <div className="flex items-center gap-2.5">
              <Switch
                id="live"
                checked={liveMode}
                onCheckedChange={(v) => {
                  setLiveMode(v);
                  if (v) setRound(maxRound);
                }}
                className="data-[state=checked]:bg-green-500"
              />
              <Label htmlFor="live" className="cursor-pointer font-medium text-sm select-none">
                {liveMode
                  ? <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />Live</span>
                  : "Playback"}
              </Label>
            </div>

            {/* Slider with Prev/Next buttons — only in playback */}
            {!liveMode && (
              <div className="flex flex-1 items-center gap-3 min-w-0 ml-4">
                <span className="text-xs font-medium text-muted-foreground shrink-0">Round</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={round === 0}
                  onClick={() => setRound((r) => Math.max(0, r - 1))}
                >
                  <IconChevronLeft className="size-4" />
                </Button>
                <Slider
                  min={0}
                  max={maxRound}
                  step={1}
                  value={[round]}
                  onValueChange={([v]) => setRound(v)}
                  className="flex-1 min-w-[120px]"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={round === maxRound}
                  onClick={() => setRound((r) => Math.min(maxRound, r + 1))}
                >
                  <IconChevronRight className="size-4" />
                </Button>
                <span className="text-sm font-bold tabular-nums shrink-0 w-14 text-right">
                  {round} <span className="text-muted-foreground font-normal">/ {maxRound}</span>
                </span>
              </div>
            )}

            <div className="ml-auto shrink-0">
              <Badge variant="outline" className="text-xs font-semibold">
                Round {round}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Graph Visualization */}
      <Card className="overflow-hidden">
        <CardHeader className="py-3 px-5 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
              <CardTitle className="text-base font-semibold">Network Topology</CardTitle>
              <CardDescription className="ml-1 text-xs">
                {graphNodes.length} nodes · {graphEdges.length} exchanges in round {round}
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-green-500 rounded" />Success</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-red-500 rounded" />Failed</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-800" />Node</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {graphNodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <div className="rounded-full bg-muted/50 p-4 mb-4">
                <IconNetwork className="text-muted-foreground/40 size-12" />
              </div>
              <p className="text-base font-semibold text-muted-foreground mb-1">No gossip data for round {round}</p>
              <p className="text-sm text-muted-foreground/60 max-w-sm text-center">Start a simulation to see peer-to-peer model exchanges.</p>
            </div>
          ) : (
            <GossipCanvas nodes={graphNodes} edges={graphEdges} />
          )}
        </CardContent>
      </Card>

      {/* Exchanges Table */}
      {graphEdges.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="py-3 px-5 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">Exchange Details</CardTitle>
                <CardDescription className="text-xs">{graphEdges.length} peer-to-peer exchanges</CardDescription>
              </div>
              <Badge variant="secondary" className="text-xs">
                {graphEdges.filter(e => e.success).length} successful
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/20">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground w-16">Status</th>
                  <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground">Source → Target</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-muted-foreground w-28">Latency</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-muted-foreground w-28">Data</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-muted-foreground w-20">Round</th>
                </tr>
              </thead>
              <tbody>
                {graphEdges.map((e, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                        e.success ? "text-green-600" : "text-red-500"
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${
                          e.success ? "bg-green-500" : "bg-red-500"
                        }`} />
                        {e.success ? "OK" : "Fail"}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs">
                      <span className="font-semibold">{e.source.slice(-8)}</span>
                      <span className="text-muted-foreground mx-1.5">→</span>
                      <span className="font-semibold">{e.target.slice(-8)}</span>
                    </td>
                    <td className="px-5 py-3 text-right text-xs tabular-nums">
                      {e.latency.toFixed(1)}<span className="text-muted-foreground ml-0.5">ms</span>
                    </td>
                    <td className="px-5 py-3 text-right text-xs tabular-nums font-medium">
                      {(e.bytes / 1024).toFixed(1)}<span className="text-muted-foreground ml-0.5">KB</span>
                    </td>
                    <td className="px-5 py-3 text-right text-xs font-mono text-muted-foreground">R{e.round}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}