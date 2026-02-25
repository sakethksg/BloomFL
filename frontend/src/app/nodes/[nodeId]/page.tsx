"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { NodeState } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EnergyBadge,
  ThermalBadge,
  fmtPct,
  fmt,
  fmtBytes,
} from "@/components/shared/NodeBadges";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

export default function NodeDetailPage() {
  const params = useParams<{ nodeId: string }>();
  const nodeId = decodeURIComponent(params.nodeId);
  const [history, setHistory] = useState<NodeState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.nodes
      .history(nodeId)
      .then((h) => { setHistory(h); setLoading(false); })
      .catch(() => setLoading(false));

    const interval = setInterval(() => {
      api.nodes.history(nodeId).then(setHistory).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [nodeId]);

  const latest = history[history.length - 1];

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!latest)
    return (
      <p className="text-sm text-muted-foreground">
        Node <code>{nodeId}</code> not found.
      </p>
    );

  const trainingData = history.map((r) => ({
    round: r.round,
    train_loss: r.train_loss,
    eval_loss: r.eval_loss,
    eval_accuracy: r.eval_accuracy != null ? r.eval_accuracy * 100 : null,
  }));

  const gossipData = history
    .filter((r) => r.gossip_latency_ms != null)
    .map((r) => ({
      round: r.round,
      latency_ms: r.gossip_latency_ms,
      bytes_kb: r.bytes_exchanged != null ? r.bytes_exchanged / 1024 : null,
      success: r.gossip_success ? 1 : 0,
    }));

  const adaptData = history.map((r) => ({
    round: r.round,
    train_epochs: r.train_epochs,
    gossip: r.gossip_enabled ? 1 : 0,
  }));

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight font-mono">
            {nodeId}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Round {latest.round} · {history.length} records
          </p>
        </div>
        <div className="flex gap-2">
          <EnergyBadge state={latest.energy_state} />
          <ThermalBadge state={latest.thermal_state} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Battery", value: latest.battery_percent != null ? `${latest.battery_percent.toFixed(0)}%` : "—" },
          { label: "CPU Temp", value: latest.cpu_temperature_c != null ? `${latest.cpu_temperature_c.toFixed(1)}°C` : "—" },
          { label: "CPU %", value: latest.cpu_percent != null ? `${latest.cpu_percent.toFixed(0)}%` : "—" },
          { label: "Peers", value: latest.peer_count.toString() },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1"><CardDescription>{s.label}</CardDescription></CardHeader>
            <CardContent><p className="text-xl font-bold">{s.value}</p></CardContent>
          </Card>
        ))}
      </div>

      {/* Inference / checkpoint card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">YOLO Inference</CardTitle>
          <CardDescription>
            Run person detection with this node’s gossip-trained checkpoint on the Detection page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-center">
          <div className="space-y-1 text-sm">
            <div className="text-muted-foreground">Detection Precision</div>
            <div className="font-mono text-lg font-semibold">
              {latest.detection_precision != null
                ? `${(latest.detection_precision * 100).toFixed(1)}%`
                : "—"}
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <div className="text-muted-foreground">mAP@50</div>
            <div className="font-mono text-lg font-semibold">
              {latest.detection_map50 != null
                ? `${(latest.detection_map50 * 100).toFixed(1)}%`
                : "—"}
            </div>
          </div>
          <Link
            href={`/inference?checkpoint=node-${nodeId}-round${latest.round}.pt`}
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Open Detection →
          </Link>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="training">
        <TabsList>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="gossip">Gossip</TabsTrigger>
          <TabsTrigger value="adaptation">Adaptation</TabsTrigger>
        </TabsList>

        {/* Training Tab */}
        <TabsContent value="training" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Loss over Rounds</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trainingData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="train_loss" stroke="#6366f1" dot={false} name="Train Loss" />
                  <Line type="monotone" dataKey="eval_loss" stroke="#f59e0b" dot={false} name="Eval Loss" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Eval Accuracy (%) over Rounds</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trainingData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => typeof v === "number" ? `${v.toFixed(1)}%` : "—"} />
                  <Line type="monotone" dataKey="eval_accuracy" stroke="#10b981" dot={false} name="Accuracy" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Gossip Tab */}
        <TabsContent value="gossip" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Gossip Latency (ms)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={gossipData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="ms" />
                  <Tooltip />
                  <Bar dataKey="latency_ms" fill="#6366f1" name="Latency ms" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Bytes Exchanged (KB)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={gossipData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="KB" />
                  <Tooltip />
                  <Bar dataKey="bytes_kb" fill="#10b981" name="KB" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Adaptation Tab */}
        <TabsContent value="adaptation" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Training Epochs per Round (throttle activity)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={adaptData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="train_epochs" fill="#f59e0b" name="Epochs" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Gossip Enabled (1=yes, 0=throttled)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={adaptData}>
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="gossip" fill="#6366f1" name="Gossip" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
