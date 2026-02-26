"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { RoundStats, Summary } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { fmtPct } from "@/components/shared/NodeBadges";
import { IconTrendingUp } from "@tabler/icons-react";

export default function ConvergencePage() {
  const [perRound, setPerRound] = useState<RoundStats[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.metrics.perRound(), api.metrics.summary()])
      .then(([pr, s]) => {
        setPerRound(pr);
        setSummary(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const chartData = perRound.map((r) => ({
    round: r.round_num,
    mean: r.mean_accuracy != null ? r.mean_accuracy * 100 : null,
    upper:
      r.mean_accuracy != null && r.std_accuracy != null
        ? (r.mean_accuracy + r.std_accuracy) * 100
        : null,
    lower:
      r.mean_accuracy != null && r.std_accuracy != null
        ? Math.max(0, (r.mean_accuracy - r.std_accuracy) * 100)
        : null,
    min: r.min_accuracy != null ? r.min_accuracy * 100 : null,
    max: r.max_accuracy != null ? r.max_accuracy * 100 : null,
    std: r.std_accuracy != null ? r.std_accuracy * 100 : null,
    gossip_rate: r.gossip_success_rate != null ? r.gossip_success_rate * 100 : null,
  }));

  if (loading) return <Skeleton className="h-96 w-full" />;

  const hasData = chartData.length > 0;
  const convergenceRound = summary?.convergence_round;
  const finalAcc = summary?.final_mean_accuracy;
  const finalStd = summary?.final_std_accuracy;

  const summaryCards = [
    {
      label: "Final Mean Accuracy",
      value: fmtPct(finalAcc),
    },
    {
      label: "Final Std Accuracy",
      value: fmtPct(finalStd),
    },
    {
      label: "Convergence Round",
      value: convergenceRound?.toString() ?? "Not converged",
    },
    {
      label: "Gossip Success Rate",
      value: fmtPct(summary?.gossip_success_rate),
    },
  ];

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <IconTrendingUp className="size-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Convergence Analysis</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Track model accuracy across all nodes over training rounds. Convergence occurs when mean accuracy peaks and standard deviation drops below target threshold.
          </p>
        </div>
        {convergenceRound && (
          <Badge className="shrink-0 px-4 py-2 text-base font-bold bg-green-600">
            Converged at R{convergenceRound}
          </Badge>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((c) => (
          <Card key={c.label} className="border-2 hover:border-primary/50 transition-colors overflow-hidden">
            <CardHeader className="pb-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{c.label}</p>
            </CardHeader>
            <CardContent className="pt-3">
              <p className="text-3xl font-bold tabular-nums">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main convergence chart */}
      <Card className="border-2 overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"></span>
            Accuracy Convergence Over Time
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Mean ± Standard Deviation (shaded area) with Min/Max range (dashed lines)
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {!hasData ? (
            <div className="flex flex-col items-center justify-center h-80 border-2 border-dashed border-muted rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-4">
                <path d="M3 3v18h18"/>
                <path d="M18 17V9"/>
                <path d="M13 17V5"/>
                <path d="M8 17v-3"/>
              </svg>
              <p className="text-base font-semibold text-muted-foreground">No convergence data available yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Run a federated learning simulation to see convergence metrics</p>
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11 }}
                unit="%"
                width={40}
              />
              <Tooltip
                formatter={(v) => typeof v === "number" ? `${v.toFixed(2)}%` : "—"}
              />
              <Legend />

              {/* ± std band */}
              <Area
                type="monotone"
                dataKey="upper"
                fill="#6366f1"
                stroke="none"
                fillOpacity={0.15}
                name="Upper (mean+std)"
                legendType="none"
              />
              <Area
                type="monotone"
                dataKey="lower"
                fill="#fff"
                stroke="none"
                fillOpacity={1}
                name="Lower (mean-std)"
                legendType="none"
              />

              {/* Min / max */}
              <Line
                type="monotone"
                dataKey="max"
                stroke="#10b981"
                dot={false}
                strokeDasharray="4 2"
                name="Max"
              />
              <Line
                type="monotone"
                dataKey="min"
                stroke="#ef4444"
                dot={false}
                strokeDasharray="4 2"
                name="Min"
              />

              {/* Mean */}
              <Line
                type="monotone"
                dataKey="mean"
                stroke="#6366f1"
                dot={false}
                strokeWidth={2.5}
                name="Mean Acc"
              />

              {/* Convergence marker */}
              {convergenceRound != null && (
                <ReferenceLine
                  x={convergenceRound}
                  stroke="#f59e0b"
                  strokeDasharray="6 3"
                  label={{
                    value: `Converged R${convergenceRound}`,
                    position: "top",
                    fontSize: 11,
                    fill: "#f59e0b",
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Std chart — shows flattening */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Accuracy Std (%) — should trend toward 0 as nodes converge
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="flex flex-col items-center justify-center h-44 border-2 border-dashed border-muted rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-2">
                <path d="M3 3v18h18"/>
                <path d="m19 9-5 5-4-4-3 3"/>
              </svg>
              <p className="text-sm font-medium text-muted-foreground">No standard deviation data</p>
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => typeof v === "number" ? `${v.toFixed(3)}%` : "—"} />
              <Line
                type="monotone"
                dataKey="std"
                stroke="#f59e0b"
                dot={false}
                strokeWidth={2}
                name="Std"
              />
              {convergenceRound != null && (
                <ReferenceLine
                  x={convergenceRound}
                  stroke="#f59e0b"
                  strokeDasharray="6 3"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Gossip success rate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Gossip Success Rate (%)</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-muted rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-2">
                <path d="M3 3v18h18"/>
                <path d="m19 9-5 5-4-4-3 3"/>
              </svg>
              <p className="text-sm font-medium text-muted-foreground">No gossip data available</p>
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="round" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => typeof v === "number" ? `${v.toFixed(1)}%` : "—"} />
              <Line
                type="monotone"
                dataKey="gossip_rate"
                stroke="#10b981"
                dot={false}
                name="Gossip Rate"
              />
            </ComposedChart>
          </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
