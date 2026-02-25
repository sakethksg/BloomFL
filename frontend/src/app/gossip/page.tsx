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
import { useWebSocket } from "@/hooks/useWebSocket";

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
function GossipCanvas({
  nodes,
  edges,
  width = 700,
  height = 480,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Place nodes in a circle
  const positions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(cx, cy) * 0.65;
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
      const radius = 14 + node.peers * 2;

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
      const label = node.id.slice(-6);
      ctx.fillText(label, pos.x, pos.y);
    }
  }, [positions, edges, nodes, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded-lg bg-muted/30 w-full max-w-full"
      style={{ maxHeight: height }}
    />
  );
}

export default function GossipPage() {
  const [allHistory, setAllHistory] = useState<Record<string, NodeState[]>>({});
  const [loading, setLoading] = useState(true);
  const [liveMode, setLiveMode] = useState(true);
  const [round, setRound] = useState(0);
  const [maxRound, setMaxRound] = useState(0);

  const loadHistory = useCallback(async () => {
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
    setLoading(false);
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

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gossip Graph</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Who exchanged with whom — green edges = success, red = failure, thickness = bytes
        </p>
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <Switch
            id="live"
            checked={liveMode}
            onCheckedChange={(v) => {
              setLiveMode(v);
              if (v) setRound(maxRound);
            }}
          />
          <Label htmlFor="live">Live mode</Label>
        </div>

        {!liveMode && (
          <div className="flex items-center gap-3 flex-1 max-w-sm">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Round:
            </span>
            <Slider
              min={0}
              max={maxRound}
              step={1}
              value={[round]}
              onValueChange={([v]) => setRound(v)}
              className="flex-1"
            />
            <span className="text-xs font-mono w-8">{round}</span>
          </div>
        )}

        {liveMode && (
          <span className="text-xs text-muted-foreground">Showing round {round}</span>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Gossip Topology — Round {round}
          </CardTitle>
          <CardDescription>
            {graphNodes.length} nodes · {graphEdges.length} exchanges
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-hidden">
          {graphNodes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No gossip data for round {round}
            </p>
          ) : (
            <GossipCanvas nodes={graphNodes} edges={graphEdges} />
          )}
        </CardContent>
      </Card>

      {/* Edge table */}
      {graphEdges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Exchanges — Round {round}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              {graphEdges.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-1 border-b last:border-0"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      e.success ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="font-mono text-xs truncate flex-1">
                    {e.source} → {e.target}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.latency.toFixed(1)} ms
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(e.bytes / 1024).toFixed(1)} KB
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
