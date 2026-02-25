"use client";

import { useEffect, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";

type Section = {
  title: string;
  fields: (keyof BloomFLConfig)[];
};

const SECTIONS: Section[] = [
  {
    title: "Node Identity & Network",
    fields: ["node_id", "listen_host", "listen_port", "transport"],
  },
  {
    title: "mDNS Discovery",
    fields: ["mdns_service_type"],
  },
  {
    title: "Training",
    fields: [
      "train_epochs_per_round",
      "batch_size",
      "learning_rate",
      "data_dir",
      "num_workers",
      "eval_every_n_rounds",
    ],
  },
  {
    title: "Gossip",
    fields: [
      "gossip_interval_seconds",
      "gossip_fan_out",
      "gossip_timeout_seconds",
      "max_payload_bytes",
    ],
  },
  {
    title: "Aggregation",
    fields: [
      "aggregation_strategy",
      "momentum_alpha",
      "partial_merge_fraction",
    ],
  },
  {
    title: "Adaptation",
    fields: [
      "adaptation_enabled",
      "thermal_high_threshold",
      "thermal_critical_threshold",
      "battery_low_threshold",
      "battery_critical_threshold",
      "battery_high_threshold",
      "adaptation_hysteresis_rounds",
    ],
  },
  {
    title: "Security & Storage",
    fields: ["grpc_use_tls", "key_storage_dir", "metrics_dir"],
  },
  {
    title: "Simulation",
    fields: [
      "sim_base_port",
      "sim_network_delay_mean_ms",
      "sim_network_delay_std_ms",
      "sim_failure_probability",
    ],
  },
];

const BOOLEAN_FIELDS = new Set<keyof BloomFLConfig>([
  "adaptation_enabled",
  "grpc_use_tls",
]);

const SELECT_FIELDS: Partial<Record<keyof BloomFLConfig, string[]>> = {
  transport: ["tcp", "grpc"],
  aggregation_strategy: ["weighted_avg", "momentum", "partial"],
};

export default function ConfigPage() {
  const [config, setConfig] = useState<BloomFLConfig | null>(null);
  const [draft, setDraft] = useState<Partial<BloomFLConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.config
      .get()
      .then((c) => {
        setConfig(c);
        setDraft({});
        setDirty(false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function update(field: keyof BloomFLConfig, value: unknown) {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.config.patch(draft as Record<string, unknown>);
      setConfig(updated);
      setDraft({});
      setDirty(false);
      toast.success("Configuration saved — restart nodes to apply");
    } catch (e) {
      toast.error(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft({});
    setDirty(false);
  }

  function val<K extends keyof BloomFLConfig>(field: K): BloomFLConfig[K] {
    return (draft[field] ?? config?.[field]) as BloomFLConfig[K];
  }

  if (loading) return <div className="px-4 lg:px-6 py-6"><Skeleton className="h-96 w-full" /></div>;
  if (!config) return <p className="px-4 lg:px-6 py-6 text-sm text-muted-foreground">Failed to load config.</p>;

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Config</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Edit BLOOMFL_* environment variables — changes are written to .env
          </p>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={discard}>
              Discard
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        )}
      </div>

      <Alert>
        <AlertDescription className="text-xs">
          Changes persist to <code>.env</code> and take effect on the next node
          restart. Running nodes will not be affected immediately.
        </AlertDescription>
      </Alert>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle className="text-sm">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {section.fields.map((field) => {
                  const current = val(field);
                  const isDirtyField = field in draft;

                  if (BOOLEAN_FIELDS.has(field)) {
                    return (
                      <div
                        key={field}
                        className={`flex items-center justify-between rounded border p-3 ${
                          isDirtyField ? "border-primary/50 bg-primary/5" : ""
                        }`}
                      >
                        <Label className="font-normal text-sm">{field}</Label>
                        <Switch
                          checked={!!current}
                          onCheckedChange={(v) => update(field, v)}
                        />
                      </div>
                    );
                  }

                  if (SELECT_FIELDS[field]) {
                    return (
                      <div
                        key={field}
                        className={`space-y-1.5 ${
                          isDirtyField ? "rounded border border-primary/50 p-2 bg-primary/5" : ""
                        }`}
                      >
                        <Label className="text-xs text-muted-foreground">
                          {field}
                        </Label>
                        <Select
                          value={String(current)}
                          onValueChange={(v) => update(field, v)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SELECT_FIELDS[field]!.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={field}
                      className={`space-y-1.5 ${
                        isDirtyField ? "rounded border border-primary/50 p-2 bg-primary/5" : ""
                      }`}
                    >
                      <Label className="text-xs text-muted-foreground">
                        {field}
                      </Label>
                      <Input
                        className="h-8 text-sm"
                        value={String(current ?? "")}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const asNum = Number(raw);
                          update(
                            field,
                            !isNaN(asNum) && raw !== "" ? asNum : raw
                          );
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {dirty && (
        <div className="sticky bottom-4 flex justify-end gap-2">
          <Button variant="outline" onClick={discard}>
            Discard
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
