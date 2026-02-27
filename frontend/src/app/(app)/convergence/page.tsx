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
import { IconTrendingUp, IconTargetArrow, IconChartBar, IconWifi } from "@tabler/icons-react";

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—.——%";
  return `${(n * 100).toFixed(2)}%`;
}

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

  const chartData = perRound.map((r) => {
    const mean = r.mean_accuracy != null ? r.mean_accuracy * 100 : null;
    const std = r.std_accuracy != null ? r.std_accuracy * 100 : null;
    
    return {
      round: r.round_num,
      mean: mean,
      // Pass an array [min, max] to properly shade the area in both Light/Dark modes
      stdBand: mean != null && std != null ? [Math.max(0, mean - std), Math.min(100, mean + std)] : null,
      min: r.min_accuracy != null ? r.min_accuracy * 100 : null,
      max: r.max_accuracy != null ? r.max_accuracy * 100 : null,
      std: std,
      gossip_rate: r.gossip_success_rate != null ? r.gossip_success_rate * 100 : null,
    };
  });

  if (loading) return <Skeleton className="h-[80vh] w-full rounded-xl m-6" />;

  const hasData = chartData.length > 0;
  const convergenceRound = summary?.convergence_round;
  const finalAcc = summary?.final_mean_accuracy;
  const finalStd = summary?.final_std_accuracy;

  const summaryCards = [
    {
      label: "Final Mean Accuracy",
      value: fmtPct(finalAcc),
      icon: <IconTrendingUp className="size-5" />,
      accentText: "text-indigo-500",
      accentBg: "bg-indigo-500/10",
      isNull: finalAcc == null,
    },
    {
      label: "Final Std Accuracy",
      value: fmtPct(finalStd),
      icon: <IconChartBar className="size-5" />,
      accentText: "text-amber-500",
      accentBg: "bg-amber-500/10",
      isNull: finalStd == null,
    },
    {
      label: "Convergence Round",
      value: convergenceRound != null ? `R${convergenceRound}` : null,
      icon: <IconTargetArrow className="size-5" />,
      accentText: "text-green-500",
      accentBg: "bg-green-500/10",
      isNull: convergenceRound == null,
    },
    {
      label: "Gossip Success Rate",
      value: fmtPct(summary?.gossip_success_rate),
      icon: <IconWifi className="size-5" />,
      accentText: "text-emerald-500",
      accentBg: "bg-emerald-500/10",
      isNull: summary?.gossip_success_rate == null,
    },
  ];

  return (
    <div className="max-w-screen-2xl mx-auto px-4 lg:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <IconTrendingUp className="size-6 text-primary" />
            Convergence Analysis
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track model accuracy across all nodes over training rounds.
          </p>
        </div>
        {convergenceRound != null && (
          <Badge className="shrink-0 px-3 py-1.5 text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30 uppercase tracking-wider">
            ✓ Converged at Round {convergenceRound}
          </Badge>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((c) => (
          <Card key={c.label} className="border shadow-sm">
            <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground w-2/3">
                  {c.label}
                </span>
                <div className={`p-2 rounded-lg ${c.accentBg} ${c.accentText}`}>
                  {c.icon}
                </div>
              </div>
              <div>
                {c.isNull ? (
                  c.label === "Convergence Round" ? (
                    <span className="text-lg font-medium italic text-muted-foreground/60">Not converged</span>
                  ) : (
                    <span className="text-3xl font-black text-muted-foreground/30">--</span>
                  )
                ) : (
                  <span className="text-3xl font-black tabular-nums tracking-tighter text-foreground">
                    {c.value}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main convergence chart */}
      <Card className="border shadow-sm overflow-hidden">
        <CardHeader className="pb-4 border-b bg-muted/10">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            Accuracy Convergence Over Rounds
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Mean ± Standard Deviation (shaded) · Min / Max (dashed)
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {!hasData ? (
            <div className="flex flex-col items-center justify-center h-80 border-2 border-dashed border-muted rounded-xl bg-muted/5">
              <IconChartBar className="size-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">No convergence data yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Run a federated learning simulation to view metrics</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorMean" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2}/>
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" vertical={false} className="stroke-muted/60" />
                <XAxis dataKey="round" tick={{ fontSize: 11 }} tickMargin={10} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={60} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    backdropFilter: 'blur(8px)',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                  }}
                  formatter={(v) => typeof v === "number" ? `${v.toFixed(2)}%` : "—"}
                  labelStyle={{ fontWeight: 'bold', color: 'var(--foreground)' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                
                {/* Standard Deviation Band */}
                <Area type="monotone" dataKey="stdBand" fill="#6366f1" stroke="none" fillOpacity={0.1} name="Std Dev Band" />
                
                {/* Colored area below the mean line */}
                <Area type="monotone" dataKey="mean" stroke="none" fill="url(#colorMean)" fillOpacity={1} legendType="none" />

                <Line type="monotone" dataKey="max" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Max Acc" />
                <Line type="monotone" dataKey="min" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Min Acc" />
                <Line type="monotone" dataKey="mean" stroke="#6366f1" strokeWidth={3} dot={false} name="Mean Acc" />
                
                {convergenceRound != null && (
                  <ReferenceLine
                    x={convergenceRound}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    label={{
                      value: `Converged R${convergenceRound}`,
                      position: "insideTopLeft",
                      fontSize: 11,
                      fill: "#f59e0b",
                      fontWeight: "bold",
                      offset: 10
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Std + Gossip side by side */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="border shadow-sm overflow-hidden">
          <CardHeader className="pb-3 border-b bg-muted/10">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Accuracy Std (%)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {!hasData ? (
              <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-muted rounded-xl bg-muted/5">
                <p className="text-xs font-medium text-muted-foreground">No std data</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} className="stroke-muted/60" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" width={50} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      backdropFilter: 'blur(8px)',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                    }}
                    formatter={(v) => typeof v === "number" ? `${v.toFixed(3)}%` : "—"}
                    labelStyle={{ fontWeight: 'bold', color: 'var(--foreground)' }}
                  />
                  <Line type="monotone" dataKey="std" stroke="#f59e0b" dot={false} strokeWidth={2.5} name="Std Dev" />
                  {convergenceRound != null && <ReferenceLine x={convergenceRound} stroke="#f59e0b" strokeDasharray="4 4" />}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border shadow-sm overflow-hidden">
          <CardHeader className="pb-3 border-b bg-muted/10">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Gossip Success Rate (%)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {!hasData ? (
              <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-muted rounded-xl bg-muted/5">
                <p className="text-xs font-medium text-muted-foreground">No gossip data</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} className="stroke-muted/60" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={50} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      backdropFilter: 'blur(8px)',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                    }}
                    formatter={(v) => typeof v === "number" ? `${v.toFixed(1)}%` : "—"}
                    labelStyle={{ fontWeight: 'bold', color: 'var(--foreground)' }}
                  />
                  <Line type="monotone" dataKey="gossip_rate" stroke="#10b981" dot={false} strokeWidth={2.5} name="Gossip Rate" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}