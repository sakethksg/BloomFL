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
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
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
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  IconRocket,
  IconServer,
  IconWifi,
  IconTargetArrow,
  IconPlayerPlay,
  IconPlayerStop,
  IconActivity,
} from "@tabler/icons-react";

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

  useWebSocket<{ event: string; round?: number; message?: string }>(
    "simulation",
    useCallback((data: { event: string; round?: number; message?: string }) => {
      if (data.round != null) {
        setStatus((s) => (s ? { ...s, progress_rounds: data.round! } : s));
      }
    }, [])
  );

  async function onSubmit(values: FormValues) {
    setResult(null);
    try {
      await api.simulation.start(values);
      toast.success("Simulation sequence initiated");
    } catch (e) {
      toast.error(`Failed to start: ${e}`);
    }
  }

  async function onStop() {
    try {
      await api.simulation.stop();
      toast.info("Simulation halted by user");
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
    <div className="max-w-screen-2xl mx-auto px-4 lg:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <IconRocket className="size-6 text-primary" />
            Simulation Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure, launch, and monitor your federated learning network.
          </p>
        </div>
        {running && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full text-green-600 dark:text-green-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-xs font-bold uppercase tracking-wider">Live</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: Configuration (4 cols) */}
        <div className="lg:col-span-4 space-y-4 sticky top-6">
          <Card className="border shadow-sm">
            <CardHeader className="pb-4 bg-muted/30 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5 pb-5">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                  {/* Topology */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b pb-1">
                      <IconServer className="size-3.5" />
                      Topology
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="num_nodes" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Nodes</FormLabel>
                          <FormControl>
                            <Input type="number" className="font-mono text-sm h-9" {...field} />
                          </FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="rounds" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Rounds</FormLabel>
                          <FormControl>
                            <Input type="number" className="font-mono text-sm h-9" {...field} />
                          </FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="transport" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Transport</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="font-mono text-sm h-9"><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="tcp">TCP</SelectItem>
                              <SelectItem value="grpc">gRPC</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="base_port" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Base Port</FormLabel>
                          <FormControl>
                            <Input type="number" className="font-mono text-sm h-9" {...field} />
                          </FormControl>
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  {/* Network Conditions */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b pb-1">
                      <IconWifi className="size-3.5" />
                      Network Conditions
                    </div>
                    <FormField control={form.control} name="mean_delay_ms" render={({ field }) => (
                      <FormItem className="space-y-1">
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-xs">Mean Delay</FormLabel>
                          <span className="text-[10px] font-mono text-muted-foreground">{field.value} ms</span>
                        </div>
                        <FormControl><Slider className="w-full py-2" min={0} max={500} step={5} value={[field.value]} onValueChange={([v]) => field.onChange(v)} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="std_delay_ms" render={({ field }) => (
                      <FormItem className="space-y-1">
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-xs">Delay Jitter</FormLabel>
                          <span className="text-[10px] font-mono text-muted-foreground">±{field.value} ms</span>
                        </div>
                        <FormControl><Slider className="w-full py-2" min={0} max={200} step={5} value={[field.value]} onValueChange={([v]) => field.onChange(v)} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="failure_prob" render={({ field }) => (
                      <FormItem className="space-y-1">
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-xs">Drop Rate</FormLabel>
                          <span className="text-[10px] font-mono text-muted-foreground">{(field.value * 100).toFixed(0)}%</span>
                        </div>
                        <FormControl><Slider className="w-full py-2" min={0} max={1} step={0.01} value={[field.value]} onValueChange={([v]) => field.onChange(v)} /></FormControl>
                      </FormItem>
                    )} />
                  </div>

                  {/* Convergence */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b pb-1">
                      <IconTargetArrow className="size-3.5" />
                      Convergence Target
                    </div>
                    <FormField control={form.control} name="convergence_threshold" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Threshold (Std Dev)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.001" className="font-mono h-9 text-sm" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value))} />
                        </FormControl>
                      </FormItem>
                    )} />
                  </div>

                  {/* Actions */}
                  <div className="pt-2 flex gap-3">
                    <Button type="submit" disabled={running} className="flex-1 font-bold shadow-md bg-green-600 hover:bg-green-700 text-white transition-all">
                      <IconPlayerPlay className="size-4 mr-2" />
                      {running ? "Running…" : "Launch Simulation"}
                    </Button>
                    {running && (
                      <Button type="button" variant="destructive" onClick={onStop} className="font-bold shadow-md">
                        <IconPlayerStop className="size-4 mr-2" />
                        Halt
                      </Button>
                    )}
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: Output (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Top Panel: Dynamic Status Area */}
          <div className="min-h-[160px]">
            {/* State 1: Idle (No Status, No Result) */}
            {!status && !result && (
              <Card className="border border-dashed bg-muted/30 shadow-none flex flex-col items-center justify-center h-full text-muted-foreground py-12">
                <IconActivity className="size-10 mb-3 opacity-20" />
                <p className="text-sm font-medium text-foreground">Awaiting Execution</p>
                <p className="text-xs">Configure your parameters on the left and click Launch.</p>
              </Card>
            )}

            {/* State 2: Running Progress */}
            {status && !result && (
              <Card className="border-2 border-primary/20 shadow-sm">
                <CardHeader className="pb-3 border-b bg-muted/10">
                  <CardTitle className="text-sm font-bold flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <IconActivity className="size-4 text-primary animate-pulse" />
                      Simulation in Progress
                    </span>
                    <span className="font-mono text-muted-foreground font-normal">
                      Round {status.progress_rounds} of {status.total_rounds}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 pb-8 space-y-3">
                  <div className="flex items-end justify-between text-sm mb-1">
                    <span className="font-bold text-foreground">Overall Progress</span>
                    <span className="text-2xl font-black text-primary tabular-nums tracking-tighter">
                      {progress.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={progress} className="h-4 bg-muted" />
                  {status.error && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded text-sm font-medium">
                      Error encountered: {status.error}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* State 3: Completed Results */}
            {result && (
              <Card className="border-green-500/30 border-2 overflow-hidden shadow-sm">
                <CardHeader className="py-3 border-b bg-muted/10">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                    Simulation Completed Successfully
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Key Metrics */}
                    <div className="md:col-span-1 flex flex-row md:flex-col gap-3">
                      <div className="flex-1 p-4 bg-background border rounded-lg flex flex-col justify-center shadow-sm">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Converged</span>
                        <span className={`text-2xl font-black ${result.converged ? 'text-green-600 dark:text-green-500' : 'text-red-500'}`}>
                          {result.converged ? "Yes" : "No"}
                        </span>
                      </div>
                      <div className="flex-1 p-4 bg-background border rounded-lg flex flex-col justify-center shadow-sm">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Duration</span>
                        <span className="text-2xl font-black text-foreground">
                          {result.wall_time_seconds.toFixed(1)}s
                        </span>
                      </div>
                    </div>

                    {/* Stats List */}
                    <div className="md:col-span-2 space-y-2 flex flex-col justify-center">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
                        Convergence Metrics
                      </span>
                      <div className="border rounded-md divide-y bg-background text-sm shadow-sm">
                        {Object.entries(result.convergence_stats).map(([k, v]) => (
                          <div key={k} className="flex justify-between items-center px-4 py-2 hover:bg-muted/30 transition-colors">
                            <span className="text-muted-foreground capitalize font-medium">{k.replaceAll("_", " ")}</span>
                            <span className="font-mono font-semibold">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}