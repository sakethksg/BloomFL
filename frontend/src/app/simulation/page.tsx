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
import { useWebSocket } from "@/hooks/useWebSocket";
import { fmtPct } from "@/components/shared/NodeBadges";

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Simulation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Launch and monitor a multi-node BloomFL simulation
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Config form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
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
                  <Button type="submit" disabled={running} className="flex-1">
                    {running ? "Running…" : "Start Simulation"}
                  </Button>
                  {running && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={onStop}
                    >
                      Stop
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
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Status:{" "}
                  <span className="capitalize font-normal">{status.status}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {running && (
                  <>
                    <Progress value={progress} />
                    <p className="text-xs text-muted-foreground">
                      Round {status.progress_rounds} / {status.total_rounds}
                    </p>
                  </>
                )}
                {status.status === "finished" && (
                  <p className="text-xs text-muted-foreground">
                    Completed in {status.wall_time_seconds?.toFixed(1)} s
                  </p>
                )}
                {status.error && (
                  <p className="text-xs text-destructive">{status.error}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Result summary */}
          {result && (
            <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
              <CardHeader>
                <CardTitle className="text-sm text-green-700 dark:text-green-400">
                  Simulation Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  Converged:{" "}
                  <strong>{result.converged ? "Yes ✓" : "No"}</strong>
                </p>
                <p>
                  Wall time:{" "}
                  <strong>{result.wall_time_seconds.toFixed(1)} s</strong>
                </p>
                {Object.entries(result.convergence_stats).map(([k, v]) => (
                  <p key={k}>
                    {k}: <strong>{String(v)}</strong>
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Log feed */}
          {logs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Event Log</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-56 px-4 pb-4">
                  <div className="font-mono text-xs space-y-0.5 mt-2">
                    {logs.map((l, i) => (
                      <p key={i} className="text-muted-foreground">
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
