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
import { useWebSocket } from "@/hooks/useWebSocket";
import { IconNetwork } from "@tabler/icons-react";

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

// Simple force-layout canvas graph (no extra dep needed)
const CANVAS_W = 900;
const CANVAS_H = 480;

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
    const r = Math.min(cx, cy) * 0.62;
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

    ctx.clearRect(0, 0, width, height);

    // Draw edges
    for (const edge of edges) {
      const s = positions[edge.source];
      const t = positions[edge.target];
      if (!s || !t) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = edge.success ? "#10b981" : "#ef4444";
      ctx.lineWidth = Math.max(1, Math.min(4, edge.bytes / 1024 / 500));
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw nodes
    for (const node of nodes) {
      const pos = positions[node.id];
      if (!pos) continue;
      // Fixed base radius; small bump per peer so size difference stays subtle
      const radius = 28 + Math.min(node.peers, 4);

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = "#6366f1";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Show last 8 chars → "node-000" for "sim-node-000"
      const label = node.id.length > 8 ? node.id.slice(-8) : node.id;
      ctx.fillText(label, pos.x, pos.y);
    }
  }, [positions, edges, nodes, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded-xl bg-gradient-to-br from-muted/20 to-muted/40 border border-muted/50 block w-full"
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <IconNetwork className="size-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Gossip Graph</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Visualize peer-to-peer model exchanges across the network — green edges indicate successful transfers, red indicates failures. Edge thickness represents data volume.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs font-semibold px-3 py-1.5">
          Round {round}
        </Badge>
      </div>

      {/* Controls */}
      <Card className="border-2">
        <CardHeader className="pb-4">
          <div className="space-y-4">
            {/* Live Mode Toggle */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Switch
                id="live"
                checked={liveMode}
                onCheckedChange={(v) => {
                  setLiveMode(v);
                  if (v) setRound(maxRound);
                }}
                className="data-[state=checked]:bg-green-500"
              />
              <Label htmlFor="live" className="flex-1 font-semibold cursor-pointer">
                {liveMode ? "🟢 Live Mode Active" : "Playback Mode"}
              </Label>
              <span className="text-xs text-muted-foreground">
                {liveMode ? "Showing latest" : "Manual round selection"}
              </span>
            </div>

            {/* Round Slider */}
            {!liveMode && (
              <div className="flex items-center gap-4">
                <Label className="text-sm font-semibold shrink-0">Select Round:</Label>
                <Slider
                  min={0}
                  max={maxRound}
                  step={1}
                  value={[round]}
                  onValueChange={([v]) => setRound(v)}
                  className="flex-1"
                />
                <div className="text-right space-y-1">
                  <div className="text-lg font-bold tabular-nums">R{round}</div>
                  <span className="text-xs text-muted-foreground">of R{maxRound}</span>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Graph Visualization */}
      <Card className="border-2 overflow-hidden">
        <CardHeader className="pb-4 bg-muted/40 border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-gradient-to-r from-green-500 to-emerald-500"></span>
                Network Topology
              </CardTitle>
              <CardDescription className="mt-1">
                {graphNodes.length} active nodes · {graphEdges.length} exchanges in round {round}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-hidden pt-4">
          {graphNodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <div className="rounded-full bg-muted/50 p-4 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
                  <circle cx="18" cy="18" r="3"/>
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="13" cy="13" r="3"/>
                  <path d="M6 21V9a9 9 0 0 0 9 9"/>
                </svg>
              </div>
              <p className="text-lg font-semibold text-muted-foreground mb-2">No gossip data for round {round}</p>
              <p className="text-sm text-muted-foreground/70 max-w-md text-center">Nodes haven't exchanged models yet in this round. Start a simulation to see peer-to-peer exchanges.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <GossipCanvas nodes={graphNodes} edges={graphEdges} />
              <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground pt-2 border-t">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-green-500 rounded"></div>
                  <span>Successful</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-red-500 rounded"></div>
                  <span>Failed</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                  <span>Node (size = peer count)</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exchanges Table */}
      {graphEdges.length > 0 && (
        <Card className="border-2 overflow-hidden">
          <CardHeader className="pb-4 bg-muted/40 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold">Exchange Details</CardTitle>
                <CardDescription className="mt-1">{graphEdges.length} peer-to-peer exchanges</CardDescription>
              </div>
              <Badge variant="secondary" className="font-semibold">{graphEdges.filter(e => e.success).length} successful</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <div className="space-y-0 min-w-full">
                <div className="grid grid-cols-5 gap-4 px-4 py-3 font-semibold text-xs bg-muted/50 rounded-lg sticky top-0 mb-2">
                  <div>Status</div>
                  <div>Source → Target</div>
                  <div className="text-right">Latency</div>
                  <div className="text-right">Data</div>
                  <div className="text-right">Round</div>
                </div>
                {graphEdges.map((e, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-5 gap-4 px-4 py-3 border-b last:border-0 hover:bg-muted/30 transition-colors text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          e.success ? "bg-green-500" : "bg-red-500"
                        }`}
                      />
                      <span className="text-xs font-semibold">{e.success ? "✓" : "✗"}</span>
                    </div>
                    <div className="font-mono text-xs truncate text-muted-foreground">
                      <span className="text-foreground font-semibold">{e.source.slice(-4)}</span>
                      <span> → </span>
                      <span className="text-foreground font-semibold">{e.target.slice(-4)}</span>
                    </div>
                    <div className="text-right text-xs">
                      <span className="font-mono">{e.latency.toFixed(1)}</span>
                      <span className="text-muted-foreground"> ms</span>
                    </div>
                    <div className="text-right text-xs">
                      <span className="font-semibold">{(e.bytes / 1024).toFixed(1)}</span>
                      <span className="text-muted-foreground"> KB</span>
                    </div>
                    <div className="text-right text-xs font-mono">R{e.round}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
