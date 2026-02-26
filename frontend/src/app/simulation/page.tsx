"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Resolver } from "react-hook-form";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { SimulationStatus, SimulationResult } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useWebSocket } from "@/hooks/useWebSocket";
import { fmtPct } from "@/components/shared/NodeBadges";
import { IconRocket } from "@tabler/icons-react";

const schema = z.object({
  num_nodes: z.coerce.number().min(2).max(16),
  rounds: z.coerce.number().min(1).max(500),
  transport: z.enum(["tcp", "grpc"]),
  base_port: z.coerce.number().min(1024).max(65000),
  mean_delay_ms: z.number().min(0).max(2000),
  std_delay_ms: z.number().min(0).max(1000),
  failure_prob: z.number().min(0).max(1),
  convergence_threshold: z.coerce.number().min(0).max(1),
});

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  num_nodes: 3,
  rounds: 20,
  transport: "tcp",
  base_port: 50100,
  mean_delay_ms: 0,
  std_delay_ms: 0,
  failure_prob: 0,
  convergence_threshold: 0.02,
};

export default function SimulationPage() {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: DEFAULTS,
  });

  const [status, setStatus] = useState<SimulationStatus | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Poll status every 2 s while running
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await api.simulation.status();
        setStatus(s);
        if (s.status === "finished") {
          const r = await api.simulation.results().catch(() => null);
          if (r) setResult(r);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // WS progress messages
  useWebSocket<{ event: string; round?: number; message?: string }>(
    "simulation",
    useCallback((data: { event: string; round?: number; message?: string }) => {
      setLogs((prev) => [
        ...prev.slice(-200),
        data.message ?? JSON.stringify(data),
      ]);
      if (data.round != null) {
        setStatus((s) =>
          s ? { ...s, progress_rounds: data.round! } : s
        );
      }
    }, [])
  );

  async function onSubmit(values: FormValues) {
    setResult(null);
    setLogs([`[${new Date().toLocaleTimeString()}] Starting simulation…`]);
    try {
      await api.simulation.start(values);
      toast.success("Simulation started");
    } catch (e) {
      toast.error(`Failed to start: ${e}`);
    }
  }

  async function onStop() {
    try {
      await api.simulation.stop();
      toast.info("Simulation stopped");
    } catch (e) {
      toast.error(`Stop failed: ${e}`);
    }
  }

  const running = status?.status === "running";
  const progress = status
    ? status.total_rounds > 0
      ? (status.progress_rounds / status.total_rounds) * 100
      : 0
    : 0;

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <IconRocket className="size-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Simulation</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Launch and monitor a multi-node BloomFL simulation with configurable network conditions and convergence parameters.
          </p>
        </div>
        {running && (
          <Badge className="shrink-0 px-4 py-2 text-base font-bold bg-green-600 animate-pulse">
            Running
          </Badge>
        )}
      </div>

      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <div>
              <p className="text-lg font-bold tracking-tight">Launch V1.0 — Now Available</p>
              <p className="text-xs text-muted-foreground">Federated learning simulation at the edge</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            {[
              { value: "3+", label: "Nodes" },
              { value: "<100ms", label: "Latency" },
              { value: "100%", label: "Privacy" },
              { value: "99.9%", label: "Uptime" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-xl font-bold tabular-nums text-primary">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Config form */}
        <Card className="border-2">
          <CardHeader className="pb-4 border-b">
            <CardTitle className="text-lg font-bold">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="num_nodes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Num Nodes</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="rounds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rounds</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="transport"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Transport</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="tcp">TCP</SelectItem>
                            <SelectItem value="grpc">gRPC</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="base_port"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Base Port</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="mean_delay_ms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Mean Network Delay — {field.value} ms
                      </FormLabel>
                      <FormControl>
                        <Slider
                          min={0}
                          max={500}
                          step={5}
                          value={[field.value]}
                          onValueChange={([v]) => field.onChange(v)}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="std_delay_ms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Delay Std — {field.value} ms
                      </FormLabel>
                      <FormControl>
                        <Slider
                          min={0}
                          max={200}
                          step={5}
                          value={[field.value]}
                          onValueChange={([v]) => field.onChange(v)}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="failure_prob"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Message Drop Probability — {(field.value * 100).toFixed(0)}%
                      </FormLabel>
                      <FormControl>
                        <Slider
                          min={0}
                          max={1}
                          step={0.01}
                          value={[field.value]}
                          onValueChange={([v]) => field.onChange(v)}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="convergence_threshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Convergence Threshold (std)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.001"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Declare convergence when accuracy std &lt; this value
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={running} className="flex-1 font-semibold">
                    {running ? "🚀 Running…" : "Start Simulation"}
                  </Button>
                  {running && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={onStop}
                      className="font-semibold"
                    >
                      ⏹ Stop
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Status + logs */}
        <div className="space-y-4">
          {/* Progress */}
          {status && (
            <Card className="border-2 overflow-hidden">
              <CardHeader className="pb-4 bg-muted/40 border-b">
                <CardTitle className="text-base font-bold">
                  Status:{" "}
                  <Badge className="ml-2 capitalize">
                    {status.status === "finished" ? "✓ Completed" : status.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {running && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold">Progress</span>
                        <span className="tabular-nums">{progress.toFixed(0)}%</span>
                      </div>
                      <Progress value={progress} className="h-3" />
                      <p className="text-xs text-muted-foreground">
                        Round {status.progress_rounds} / {status.total_rounds}
                      </p>
                    </div>
                  </>
                )}
                {status.status === "finished" && (
                  <div className="space-y-2 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                      ✓ Simulation completed successfully
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Wall time: {status.wall_time_seconds?.toFixed(2)} seconds
                    </p>
                  </div>
                )}
                {status.error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <p className="text-xs text-destructive font-medium">{status.error}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Result summary */}
          {result && (
            <Card className="border-2 border-green-500/50 overflow-hidden">
              <CardHeader className="pb-4 bg-gradient-to-r from-green-500/10 to-transparent border-b border-green-500/30">
                <CardTitle className="text-base font-bold text-green-700 dark:text-green-400 flex items-center gap-2">
                  <span className="text-2xl">✓</span> Simulation Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted/40 rounded-lg">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Converged</p>
                    <p className="text-lg font-bold">{result.converged ? "✓ Yes" : "✗ No"}</p>
                  </div>
                  <div className="p-3 bg-muted/40 rounded-lg">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Duration</p>
                    <p className="text-lg font-bold">{result.wall_time_seconds.toFixed(1)}s</p>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  {Object.entries(result.convergence_stats).map(([k, v]) => (
                    <p key={k} className="flex justify-between">
                      <span className="text-muted-foreground capitalize">{k.replace("_", " ")}:</span>
                      <strong>{String(v)}</strong>
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Log feed */}
          {logs.length > 0 && (
            <Card className="border-2 overflow-hidden">
              <CardHeader className="pb-4 bg-muted/40 border-b">
                <CardTitle className="text-base font-bold">Event Log</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-64 px-4 py-4">
                  <div className="font-mono text-xs space-y-1">
                    {logs.map((l, i) => (
                      <p key={i} className="text-muted-foreground hover:text-foreground transition-colors">
                        {l}
                      </p>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
