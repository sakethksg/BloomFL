"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { BloomFLConfig } from "@/lib/types";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { IconSettings, IconDeviceFloppy, IconX, IconInfoCircle } from "@tabler/icons-react";

// ── Zod Schema ────────────────────────────────────────────────────────────────

const configSchema = z.object({
  node_id: z.string().min(1, "Node ID is required"),
  listen_host: z.string().min(1, "Host is required"),
  listen_port: z.coerce.number().int().min(1).max(65535, "Port must be 1–65535"),
  transport: z.enum(["tcp", "grpc"]),
  mdns_service_type: z.string().min(1, "Required"),
  train_epochs_per_round: z.coerce.number().int().min(1, "At least 1 epoch"),
  batch_size: z.coerce.number().int().min(1, "At least 1"),
  learning_rate: z.coerce.number().min(1e-6, "Too small").max(1, "Too large"),
  data_dir: z.string().min(1, "Required"),
  num_workers: z.coerce.number().int().min(0),
  eval_every_n_rounds: z.coerce.number().int().min(1),
  gossip_interval_seconds: z.coerce.number().min(0.1),
  gossip_fan_out: z.coerce.number().int().min(1),
  gossip_timeout_seconds: z.coerce.number().min(0.1),
  max_payload_bytes: z.coerce.number().int().min(1024),
  aggregation_strategy: z.enum(["weighted_avg", "momentum", "partial"]),
  momentum_alpha: z.coerce.number().min(0).max(1, "Must be 0–1"),
  partial_merge_fraction: z.coerce.number().min(0).max(1, "Must be 0–1"),
  adaptation_enabled: z.boolean(),
  thermal_high_threshold: z.coerce.number().min(0),
  thermal_critical_threshold: z.coerce.number().min(0),
  battery_low_threshold: z.coerce.number().min(0).max(100),
  battery_critical_threshold: z.coerce.number().min(0).max(100),
  battery_high_threshold: z.coerce.number().min(0).max(100),
  adaptation_hysteresis_rounds: z.coerce.number().int().min(0),
  grpc_use_tls: z.boolean(),
  key_storage_dir: z.string().min(1, "Required"),
  metrics_dir: z.string().min(1, "Required"),
  sim_base_port: z.coerce.number().int().min(1024).max(65000),
  sim_network_delay_mean_ms: z.coerce.number().min(0),
  sim_network_delay_std_ms: z.coerce.number().min(0),
  sim_failure_probability: z.coerce.number().min(0).max(1, "Must be 0–1"),
});

type ConfigFormInput = z.input<typeof configSchema>;
type ConfigForm = z.output<typeof configSchema>;

// ── Section definitions ───────────────────────────────────────────────────────

type FieldMeta = {
  key: keyof ConfigForm;
  label: string;
  description?: string;
  type: "text" | "number" | "boolean" | "select";
  options?: string[];
  step?: string;
};

const SECTIONS: { title: string; description: string; fields: FieldMeta[] }[] = [
  {
    title: "Identity & Network",
    description: "Configure how this node identifies itself and communicates with the federated network.",
    fields: [
      { key: "node_id", label: "Node ID", type: "text" },
      { key: "listen_host", label: "Listen Host", type: "text" },
      { key: "listen_port", label: "Listen Port", type: "number" },
      { key: "transport", label: "Transport Protocol", type: "select", options: ["tcp", "grpc"] },
      { key: "mdns_service_type", label: "mDNS Service Type", type: "text" },
    ],
  },
  {
    title: "Training Parameters",
    description: "Local model training hyperparameters and data paths.",
    fields: [
      { key: "train_epochs_per_round", label: "Epochs per Round", type: "number" },
      { key: "batch_size", label: "Batch Size", type: "number" },
      { key: "learning_rate", label: "Learning Rate", type: "number", step: "0.0001" },
      { key: "num_workers", label: "Number of Workers", type: "number" },
      { key: "eval_every_n_rounds", label: "Eval Every 'N' Rounds", type: "number" },
      { key: "data_dir", label: "Data Directory", type: "text" },
    ],
  },
  {
    title: "Gossip Protocol",
    description: "Peer-to-peer weight sharing and synchronization settings.",
    fields: [
      { key: "gossip_interval_seconds", label: "Sync Interval (s)", type: "number", step: "0.1" },
      { key: "gossip_fan_out", label: "Fan Out", type: "number" },
      { key: "gossip_timeout_seconds", label: "Timeout (s)", type: "number", step: "0.1" },
      { key: "max_payload_bytes", label: "Max Payload (bytes)", type: "number" },
    ],
  },
  {
    title: "Model Aggregation",
    description: "Strategies for merging peer weights into the local model.",
    fields: [
      { key: "aggregation_strategy", label: "Merge Strategy", type: "select", options: ["weighted_avg", "momentum", "partial"] },
      { key: "momentum_alpha", label: "Momentum Alpha", type: "number", step: "0.01", description: "Values between 0.0 and 1.0" },
      { key: "partial_merge_fraction", label: "Partial Merge Fraction", type: "number", step: "0.01", description: "Values between 0.0 and 1.0" },
    ],
  },
  {
    title: "Hardware Adaptation",
    description: "Dynamically adjust training intensity based on device thermals and battery.",
    fields: [
      { key: "adaptation_enabled", label: "Enable Hardware Adaptation", type: "boolean", description: "Throttle training when resources are constrained." },
      { key: "adaptation_hysteresis_rounds", label: "Hysteresis Rounds", type: "number" },
      { key: "thermal_high_threshold", label: "Thermal High (°C)", type: "number" },
      { key: "thermal_critical_threshold", label: "Thermal Critical (°C)", type: "number" },
      { key: "battery_high_threshold", label: "Battery High (%)", type: "number" },
      { key: "battery_low_threshold", label: "Battery Low (%)", type: "number" },
      { key: "battery_critical_threshold", label: "Battery Critical (%)", type: "number" },
    ],
  },
  {
    title: "Security & Telemetry",
    description: "File paths for keys, metrics, and encryption settings.",
    fields: [
      { key: "grpc_use_tls", label: "Enable TLS for gRPC", type: "boolean" },
      { key: "key_storage_dir", label: "Key Storage Directory", type: "text" },
      { key: "metrics_dir", label: "Metrics Directory", type: "text" },
    ],
  },
  {
    title: "Simulation Settings",
    description: "Overrides for local testing and network disruption simulations.",
    fields: [
      { key: "sim_base_port", label: "Base Port", type: "number" },
      { key: "sim_network_delay_mean_ms", label: "Delay Mean (ms)", type: "number" },
      { key: "sim_network_delay_std_ms", label: "Delay Std (ms)", type: "number" },
      { key: "sim_failure_probability", label: "Failure Probability", type: "number", step: "0.01", description: "Values between 0.0 and 1.0" },
    ],
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConfigPage() {
  const form = useForm<ConfigFormInput, unknown, ConfigForm>({
    resolver: zodResolver(configSchema),
  });

  const { formState: { isDirty, isSubmitting, errors, isLoading } } = form;
  const errorCount = Object.keys(errors).length;

  useEffect(() => {
    api.config.get()
      .then((c: BloomFLConfig) => {
        form.reset(c as unknown as ConfigFormInput);
      })
      .catch(() => toast.error("Failed to load config"));
  }, [form]);

  async function onSubmit(data: ConfigForm) {
    try {
      const updated = await api.config.patch(data as unknown as Record<string, unknown>);
      form.reset(updated as unknown as ConfigFormInput);
      toast.success("Configuration saved", {
        description: "Restart your nodes to apply these changes."
      });
    } catch (e) {
      toast.error(`Save failed: ${e}`);
    }
  }

  if (!form.getValues("node_id") && !isDirty && !isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="relative min-h-screen pb-24" noValidate>
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">

          {/* Header */}
          <div className="flex flex-col gap-4 border-b pb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <IconSettings className="size-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
                <p className="text-muted-foreground mt-1">
                  Manage environment variables for your BLOOMFL network.
                </p>
              </div>
            </div>

            <Alert className="bg-muted/50 border-none max-w-2xl mt-2">
              <IconInfoCircle className="size-4" />
              <AlertTitle>Restart Required</AlertTitle>
              <AlertDescription className="text-muted-foreground">
                Changes persist to your <code>.env</code> file. Running nodes will not reflect these changes until they are rebooted.
              </AlertDescription>
            </Alert>
          </div>

          {/* Sections using Left/Right Layout */}
          <div className="space-y-12">
            {SECTIONS.map((section) => (
              <div key={section.title} className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-12">
                {/* Left Column: Title & Description */}
                <div className="md:col-span-1 space-y-2">
                  <h2 className="text-lg font-semibold leading-none tracking-tight">{section.title}</h2>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>

                {/* Right Column: Form Fields */}
                <Card className="md:col-span-2 shadow-sm">
                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                      {section.fields.map((f) => {
                        const hasError = !!errors[f.key];

                        // ── Boolean Field (Switch) ──
                        if (f.type === "boolean") {
                          return (
                            <FormField
                              key={f.key}
                              control={form.control}
                              name={f.key}
                              render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 sm:col-span-2 shadow-sm">
                                  <div className="space-y-0.5">
                                    <FormLabel className="text-base cursor-pointer">{f.label}</FormLabel>
                                    {f.description && (
                                      <FormDescription>{f.description}</FormDescription>
                                    )}
                                  </div>
                                  <FormControl>
                                    <Switch
                                      checked={!!field.value}
                                      onCheckedChange={field.onChange}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          );
                        }

                        // ── Select Field ──
                        if (f.type === "select") {
                          return (
                            <FormField
                              key={f.key}
                              control={form.control}
                              name={f.key}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{f.label}</FormLabel>
                                  <Select value={String(field.value ?? "")} onValueChange={field.onChange}>
                                    <FormControl>
                                      <SelectTrigger className={hasError ? "border-destructive focus:ring-destructive" : ""}>
                                        <SelectValue placeholder="Select option" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {f.options!.map((opt) => (
                                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {f.description && <FormDescription>{f.description}</FormDescription>}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          );
                        }

                        // ── Text / Number Field ──
                        // Make data_dir and some others span full width if needed, otherwise 1 col
                        const isFullWidth = f.key === "data_dir" || f.key === "key_storage_dir" || f.key === "metrics_dir";

                        return (
                          <FormField
                            key={f.key}
                            control={form.control}
                            name={f.key}
                            render={({ field }) => (
                              <FormItem className={isFullWidth ? "sm:col-span-2" : ""}>
                                <FormLabel>{f.label}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type={f.type === "number" ? "number" : "text"}
                                    step={f.step}
                                    value={field.value == null ? "" : String(field.value)}
                                    className={`font-mono text-sm ${hasError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                  />
                                </FormControl>
                                {f.description && <FormDescription>{f.description}</FormDescription>}
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>

        {/* Floating Action Bar */}
        {isDirty && (
          <div className="fixed bottom-6 left-0 right-0 z-50 mx-auto w-max max-w-full px-4 animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className="flex items-center gap-4 rounded-full border bg-background/80 backdrop-blur-md p-2 shadow-lg ring-1 ring-border">
              <div className="flex items-center gap-2 px-3 text-sm font-medium">
                {errorCount > 0 ? (
                  <Badge variant="destructive" className="rounded-full">
                    {errorCount} Error{errorCount !== 1 ? "s" : ""}
                  </Badge>
                ) : (
                  <span className="text-amber-600 dark:text-amber-500 flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                    </span>
                    Unsaved changes
                  </span>
                )}
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex gap-2 pl-1 pr-1">
                <Button type="button" variant="ghost" size="sm" className="rounded-full px-4" onClick={() => form.reset()}>
                  <IconX className="size-4 mr-1.5" /> Discard
                </Button>
                <Button type="submit" size="sm" disabled={isSubmitting || errorCount > 0} className="rounded-full px-6 shadow-sm">
                  <IconDeviceFloppy className="size-4 mr-1.5" />
                  {isSubmitting ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </form>
    </Form>
  );
}