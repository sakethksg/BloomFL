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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { IconChartLine } from "@tabler/icons-react";

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

  if (loading) return <Skeleton className="h-96 w-full mx-4 lg:mx-6 mt-6" />;

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <IconChartLine className="size-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Training Metrics</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Monitor per-node training and evaluation metrics across all rounds. Compare accuracy and loss across different nodes.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <a href={api.metrics.exportUrl()} download>
            Export JSON
          </a>
        </Button>
      </div>

      {/* Node filter */}
      {nodeIds.length > 0 && (
        <Card className="border-2 bg-muted/20">
          <CardHeader className="pb-4">
            <div className="space-y-3">
              <h3 className="font-bold text-sm">Filter Nodes</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {nodeIds.map((id, idx) => (
                  <button
                    key={id}
                    onClick={() =>
                      setSelectedNodes((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                      )
                    }
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all hover:shadow-md"
                    style={{
                      borderColor: COLORS[idx % COLORS.length],
                      backgroundColor: selectedNodes.includes(id)
                        ? COLORS[idx % COLORS.length] + "20"
                        : "transparent",
                      color: COLORS[idx % COLORS.length],
                      opacity: selectedNodes.includes(id) ? 1 : 0.5,
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: COLORS[idx % COLORS.length] }}
                    />
                    {id.slice(-8)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedNodes.length} of {nodeIds.length} nodes selected
              </p>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Loss chart */}
        <Card className="border-2 overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-orange-500"></span>
              Validation Loss
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-2">Loss per node across training rounds</p>
          </CardHeader>
          <CardContent className="pt-6">
            {lossData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-muted rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-3">
                  <path d="M3 3v18h18"/>
                  <path d="m19 9-5 5-4-4-3 3"/>
                </svg>
                <p className="text-sm font-semibold text-muted-foreground">No loss data available yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Start a simulation to view training metrics</p>
              </div>
            ) : (
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
            )}
          </CardContent>
        </Card>

        {/* Accuracy chart */}
        <Card className="border-2 overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span>
              Validation Accuracy
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-2">Accuracy percentage per node across training rounds</p>
          </CardHeader>
          <CardContent className="pt-6">
            {accData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-muted rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-3">
                  <path d="M3 3v18h18"/>
                  <path d="m19 9-5 5-4-4-3 3"/>
                </svg>
                <p className="text-sm font-semibold text-muted-foreground">No accuracy data available yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Start a simulation to view training metrics</p>
              </div>
            ) : (
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mean ± std band */}
      {bandData.length > 0 && (
        <Card className="border-2 overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-indigo-500"></span>
              Aggregate Accuracy Trend
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-2">Mean accuracy across all nodes with standard deviation band</p>
          </CardHeader>
          <CardContent className="pt-6">
            <ResponsiveContainer width="100%" height={260}>
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
