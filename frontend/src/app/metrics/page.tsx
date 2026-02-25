"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { RoundStats, NodeState } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";

const COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6",
];

export default function MetricsPage() {
  const [perRound, setPerRound] = useState<RoundStats[]>([]);
  const [allHistory, setAllHistory] = useState<Record<string, NodeState[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      api.metrics.perRound(),
      api.nodes.list().then((nodes) =>
        Promise.all(
          nodes.map((n) =>
            api.nodes.history(n.node_id).then((h) => [n.node_id, h] as const)
          )
        ).then((entries) => Object.fromEntries(entries))
      ),
    ])
      .then(([pr, history]) => {
        setPerRound(pr);
        setAllHistory(history);
        setSelectedNodes(Object.keys(history));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const nodeIds = Object.keys(allHistory);

  // Build per-node loss data keyed by round
  const lossData = (() => {
    const map: Record<number, Record<string, number>> = {};
    for (const nodeId of selectedNodes) {
      for (const r of allHistory[nodeId] ?? []) {
        if (r.eval_loss == null) continue;
        if (!map[r.round]) map[r.round] = { round: r.round } as Record<string, number>;
        map[r.round][nodeId] = r.eval_loss;
      }
    }
    return Object.values(map).sort((a, b) => a.round - b.round);
  })();

  const accData = (() => {
    const map: Record<number, Record<string, number>> = {};
    for (const nodeId of selectedNodes) {
      for (const r of allHistory[nodeId] ?? []) {
        if (r.eval_accuracy == null) continue;
        if (!map[r.round]) map[r.round] = { round: r.round } as Record<string, number>;
        map[r.round][nodeId] = r.eval_accuracy * 100;
      }
    }
    return Object.values(map).sort((a, b) => a.round - b.round);
  })();

  // Aggregate band data for mean±std
  const bandData = perRound.map((r) => ({
    round: r.round_num,
    mean: r.mean_accuracy != null ? r.mean_accuracy * 100 : null,
    upper: r.mean_accuracy != null && r.std_accuracy != null
      ? (r.mean_accuracy + r.std_accuracy) * 100
      : null,
    lower: r.mean_accuracy != null && r.std_accuracy != null
      ? Math.max(0, (r.mean_accuracy - r.std_accuracy) * 100)
      : null,
  }));

  if (loading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Metrics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-node training/evaluation metrics across rounds
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={api.metrics.exportUrl()} download>
            Export JSON
          </a>
        </Button>
      </div>

      {/* Node filter */}
      {nodeIds.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Show nodes:</span>
          {nodeIds.map((id, idx) => (
            <button
              key={id}
              onClick={() =>
                setSelectedNodes((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                )
              }
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border transition-opacity"
              style={{
                borderColor: COLORS[idx % COLORS.length],
                color: COLORS[idx % COLORS.length],
                opacity: selectedNodes.includes(id) ? 1 : 0.35,
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: COLORS[idx % COLORS.length] }}
              />
              {id}
            </button>
          ))}
        </div>
      )}

      {/* Loss chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Eval Loss per Node</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={lossData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {selectedNodes.map((id, idx) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  stroke={COLORS[idx % COLORS.length]}
                  dot={false}
                  name={id}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Accuracy chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Eval Accuracy (%) per Node</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={accData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => typeof v === "number" ? `${v.toFixed(1)}%` : "—"} />
              <Legend />
              {selectedNodes.map((id, idx) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  stroke={COLORS[idx % COLORS.length]}
                  dot={false}
                  name={id}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Mean ± std band */}
      {bandData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Mean Accuracy (%) ± Std across All Nodes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={bandData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => typeof v === "number" ? `${v.toFixed(1)}%` : "—"} />
                <Area
                  type="monotone"
                  dataKey="upper"
                  stroke="none"
                  fill="#6366f1"
                  fillOpacity={0.15}
                  name="Upper"
                />
                <Area
                  type="monotone"
                  dataKey="lower"
                  stroke="none"
                  fill="#6366f1"
                  fillOpacity={0}
                  name="Lower"
                />
                <Line
                  type="monotone"
                  dataKey="mean"
                  stroke="#6366f1"
                  dot={false}
                  strokeWidth={2}
                  name="Mean Acc"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
