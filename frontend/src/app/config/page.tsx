"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { BloomFLConfig } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { IconSettings, IconDeviceFloppy, IconX } from "@tabler/icons-react";

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

const SECTIONS: { title: string; fields: FieldMeta[] }[] = [
  {
    title: "Node Identity & Network",
    fields: [
      { key: "node_id", label: "Node ID", type: "text" },
      { key: "listen_host", label: "Listen Host", type: "text" },
      { key: "listen_port", label: "Listen Port", type: "number" },
      { key: "transport", label: "Transport", type: "select", options: ["tcp", "grpc"] },
    ],
  },
  {
    title: "mDNS Discovery",
    fields: [
      { key: "mdns_service_type", label: "mDNS Service Type", type: "text" },
    ],
  },
  {
    title: "Training",
    fields: [
      { key: "train_epochs_per_round", label: "Epochs per Round", type: "number" },
      { key: "batch_size", label: "Batch Size", type: "number" },
      { key: "learning_rate", label: "Learning Rate", type: "number", step: "0.0001" },
      { key: "data_dir", label: "Data Directory", type: "text" },
      { key: "num_workers", label: "Num Workers", type: "number" },
      { key: "eval_every_n_rounds", label: "Eval Every N Rounds", type: "number" },
    ],
  },
  {
    title: "Gossip",
    fields: [
      { key: "gossip_interval_seconds", label: "Interval (s)", type: "number", step: "0.1" },
      { key: "gossip_fan_out", label: "Fan Out", type: "number" },
      { key: "gossip_timeout_seconds", label: "Timeout (s)", type: "number", step: "0.1" },
      { key: "max_payload_bytes", label: "Max Payload (bytes)", type: "number" },
    ],
  },
  {
    title: "Aggregation",
    fields: [
      { key: "aggregation_strategy", label: "Strategy", type: "select", options: ["weighted_avg", "momentum", "partial"] },
      { key: "momentum_alpha", label: "Momentum Alpha", type: "number", step: "0.01", description: "0–1" },
      { key: "partial_merge_fraction", label: "Partial Merge Fraction", type: "number", step: "0.01", description: "0–1" },
    ],
  },
  {
    title: "Adaptation",
    fields: [
      { key: "adaptation_enabled", label: "Enable Adaptation", type: "boolean" },
      { key: "thermal_high_threshold", label: "Thermal High (°C)", type: "number" },
      { key: "thermal_critical_threshold", label: "Thermal Critical (°C)", type: "number" },
      { key: "battery_low_threshold", label: "Battery Low (%)", type: "number" },
      { key: "battery_critical_threshold", label: "Battery Critical (%)", type: "number" },
      { key: "battery_high_threshold", label: "Battery High (%)", type: "number" },
      { key: "adaptation_hysteresis_rounds", label: "Hysteresis Rounds", type: "number" },
    ],
  },
  {
    title: "Security & Storage",
    fields: [
      { key: "grpc_use_tls", label: "Use TLS", type: "boolean" },
      { key: "key_storage_dir", label: "Key Storage Dir", type: "text" },
      { key: "metrics_dir", label: "Metrics Dir", type: "text" },
    ],
  },
  {
    title: "Simulation",
    fields: [
      { key: "sim_base_port", label: "Base Port", type: "number" },
      { key: "sim_network_delay_mean_ms", label: "Delay Mean (ms)", type: "number" },
      { key: "sim_network_delay_std_ms", label: "Delay Std (ms)", type: "number" },
      { key: "sim_failure_probability", label: "Failure Probability", type: "number", step: "0.01", description: "0–1" },
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
      toast.success("Configuration saved — restart nodes to apply");
    } catch (e) {
      toast.error(`Save failed: ${e}`);
    }
  }

  // Show skeleton until default values populate
  if (!form.getValues("node_id") && !isDirty && !isLoading) {
    return (
      <div className="px-4 lg:px-6 py-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className="space-y-6 px-4 lg:px-6 py-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <IconSettings className="size-6 text-primary" />
                <h1 className="text-2xl font-bold tracking-tight">Config</h1>
                {isDirty && (
                  <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                    Unsaved changes
                  </Badge>
                )}
                {errorCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {errorCount} error{errorCount !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Edit BLOOMFL_* environment variables — changes are written to .env
              </p>
            </div>
            {isDirty && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => form.reset()}>
                  <IconX className="size-3.5" /> Discard
                </Button>
                <Button type="submit" size="sm" disabled={isSubmitting} className="gap-1.5">
                  <IconDeviceFloppy className="size-3.5" />
                  {isSubmitting ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            )}
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              Changes persist to <code>.env</code> and take effect on the next node restart.
              Running nodes will not be affected immediately.
            </AlertDescription>
          </Alert>

          {/* Sections */}
          <div className="space-y-4">
            {SECTIONS.map((section) => (
              <Card key={section.title} className="border-2">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {section.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {section.fields.map((f) => {
                      const hasError = !!errors[f.key];

                      if (f.type === "boolean") {
                        return (
                          <FormField
                            key={f.key}
                            control={form.control}
                            name={f.key}
                            render={({ field }) => (
                              <FormItem className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${hasError ? "border-destructive bg-destructive/5" : "hover:border-primary/40"}`}>
                                <FormLabel className="font-medium text-sm cursor-pointer">{f.label}</FormLabel>
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

                      if (f.type === "select") {
                        return (
                          <FormField
                            key={f.key}
                            control={form.control}
                            name={f.key}
                            render={() => (
                              <FormItem>
                                <FormLabel className="text-xs text-muted-foreground font-medium">{f.label}</FormLabel>
                                <Controller
                                  name={f.key}
                                  control={form.control}
                                  render={({ field: cf }) => (
                                    <Select value={String(cf.value ?? "")} onValueChange={cf.onChange}>
                                      <FormControl>
                                        <SelectTrigger className={`h-9 text-sm ${hasError ? "border-destructive" : ""}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {f.options!.map((opt) => (
                                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                                <FormMessage className="text-xs" />
                              </FormItem>
                            )}
                          />
                        );
                      }

                      return (
                        <FormField
                          key={f.key}
                          control={form.control}
                          name={f.key}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground font-medium">
                                {f.label}
                                {f.description && (
                                  <span className="ml-1 font-normal text-muted-foreground/60">({f.description})</span>
                                )}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type={f.type === "number" ? "number" : "text"}
                                  step={f.step}
                                  value={field.value == null ? "" : String(field.value)}
                                  className={`h-9 text-sm font-mono ${hasError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                                />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )}
                        />
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Sticky save bar */}
          {isDirty && (
            <div className="sticky bottom-4 flex justify-end gap-2">
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => form.reset()}>
                <IconX className="size-4" /> Discard
              </Button>
              <Button type="submit" disabled={isSubmitting} className="gap-1.5">
                <IconDeviceFloppy className="size-4" />
                {isSubmitting ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}

        </div>
      </form>
    </Form>
  );
}
