"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CheckpointInfo, NodeDetectionResult } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IconScan,
  IconUpload,
  IconX,
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconRefresh,
} from "@tabler/icons-react";

// ── Confidence slider ─────────────────────────────────────────────────────────

function ConfSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="w-full space-y-3">
      <label className="text-sm font-semibold text-foreground">Confidence Threshold: {(value * 100).toFixed(0)}%</label>
      <input
        type="range" min={0.01} max={1} step={0.01} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>1%</span>
        <span className="font-mono">{(value * 100).toFixed(0)}%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith("image/")) onFile(f);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={[
        "flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-all cursor-pointer select-none hover:scale-105 duration-300",
        dragging ? "border-primary bg-primary/10 scale-105" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/50",
        disabled ? "opacity-50 cursor-not-allowed hover:scale-100" : "",
      ].join(" ")}
    >
      <div className="rounded-full bg-primary/10 p-4">
        <IconUpload className="size-8 text-primary" />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-foreground">Drop an image here or click to browse</p>
        <p className="text-sm text-muted-foreground mt-1.5">Supported formats: JPEG · PNG · WebP · BMP</p>
      </div>
      <input
        ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = ""; } }}
      />
    </div>
  );
}

// ── Per-node result card ──────────────────────────────────────────────────────

function NodeResultCard({ result }: { result: NodeDetectionResult }) {
  const hasBadge = result.error
    ? <Badge variant="destructive" className="text-xs">Error</Badge>
    : result.person_count > 0
    ? <Badge className="bg-green-600 text-white text-xs">{result.person_count} person{result.person_count !== 1 ? "s" : ""}</Badge>
    : <Badge variant="secondary" className="text-xs">No persons</Badge>;

  return (
    <Card className="overflow-hidden flex flex-col border-2 hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3 border-b bg-muted/40">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-mono font-bold truncate">{result.node_label}</CardTitle>
            <CardDescription className="truncate text-xs mt-1">{result.model_path}</CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasBadge}
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
              {result.inference_time_ms.toFixed(1)} ms
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4 flex-1 flex flex-col">
        {result.error ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive font-medium">{result.error}</div>
        ) : (
          <>
            {result.annotated_jpeg_b64 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/jpeg;base64,${result.annotated_jpeg_b64}`}
                alt={`Detection result for ${result.node_label}`}
                className="w-full rounded-lg object-contain max-h-56"
              />
            )}
            <div className="text-xs text-muted-foreground font-medium">
              {result.boxes.length} object{result.boxes.length !== 1 ? "s" : ""} detected
            </div>
            {result.boxes.length > 0 && (
              <div className="rounded-lg border overflow-auto max-h-40 flex-1">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-bold">Class</TableHead>
                      <TableHead className="text-xs font-bold text-right">Conf</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.boxes.map((box, i) => (
                      <TableRow key={i} className={box.class_id === 0 ? "bg-green-500/10 hover:bg-green-500/20" : "hover:bg-muted"}>
                        <TableCell className={box.class_id === 0 ? "font-semibold text-green-600 dark:text-green-400 text-xs" : "text-muted-foreground text-xs"}>
                          {box.class_name}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-right">{(box.conf * 100).toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Checkpoint selector ───────────────────────────────────────────────────────

function CheckpointSelector({
  checkpoints,
  selected,
  onToggle,
  onSelectAll,
  loading,
}: {
  checkpoints: CheckpointInfo[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (!checkpoints.length) return (
    <p className="text-sm text-muted-foreground px-1">
      No checkpoints found. Run a simulation to train node models.
    </p>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{selected.size} of {checkpoints.length} selected</p>
        <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={onSelectAll}>
          {selected.size === checkpoints.length ? "Deselect all" : "Select all"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {checkpoints.map((ckpt) => (
          <label
            key={ckpt.path}
            className={[
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
              selected.has(ckpt.path) ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40",
              !ckpt.exists ? "opacity-50" : "",
            ].join(" ")}
          >
            <input
              type="checkbox"
              className="accent-primary"
              checked={selected.has(ckpt.path)}
              disabled={!ckpt.exists}
              onChange={() => onToggle(ckpt.path)}
            />
            <span className="font-mono flex-1 truncate">{ckpt.label}</span>
            {ckpt.is_pretrained && <Badge variant="secondary" className="text-xs shrink-0">pretrained</Badge>}
            {!ckpt.exists && <span className="text-xs text-muted-foreground shrink-0">missing</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InferencePage() {
  const [conf, setConf] = useState(0.35);
  const [multiMode, setMultiMode] = useState(false);

  // Checkpoint state
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [ckptLoading, setCkptLoading] = useState(true);
  const [selectedCkpts, setSelectedCkpts] = useState<Set<string>>(new Set());

  // Single mode state
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [annotatedSrc, setAnnotatedSrc] = useState<string | null>(null);

  // Multi mode state
  const [multiResults, setMultiResults] = useState<NodeDetectionResult[]>([]);

  // Shared
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(true);

  // Load checkpoints + model status
  useEffect(() => {
    api.inference.status().then((s) => setModelLoaded(s.model_loaded)).catch(() => {});
    api.inference.checkpoints()
      .then((list) => {
        setCheckpoints(list);
        setSelectedCkpts(new Set(list.filter((c) => c.exists).map((c) => c.path)));
      })
      .catch(() => {})
      .finally(() => setCkptLoading(false));
  }, []);

  const toggleCheckpoint = (path: string) => {
    setSelectedCkpts((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    const existing = checkpoints.filter((c) => c.exists).map((c) => c.path);
    if (selectedCkpts.size === existing.length) setSelectedCkpts(new Set());
    else setSelectedCkpts(new Set(existing));
  };

  const refreshCheckpoints = () => {
    setCkptLoading(true);
    api.inference.checkpoints()
      .then((list) => {
        setCheckpoints(list);
        setSelectedCkpts(new Set(list.filter((c) => c.exists).map((c) => c.path)));
      })
      .catch(() => {})
      .finally(() => setCkptLoading(false));
  };

  // ── File handler ─────────────────────────────────────────────────────────

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setMultiResults([]);
      setAnnotatedSrc(null);
      setOriginalSrc(URL.createObjectURL(file));
      setLoading(true);

      try {
        if (multiMode) {
          const selected = Array.from(selectedCkpts);
          if (!selected.length) {
            setError("Select at least one checkpoint.");
            setLoading(false);
            return;
          }
          const results = await api.inference.detectMultiAnnotated(file, conf, selected);
          setMultiResults(results);
        } else {
          const [, annotatedBlob] = await Promise.all([
            api.inference.detect(file, conf),
            api.inference.detectAnnotated(file, conf),
          ]);
          setAnnotatedSrc(URL.createObjectURL(annotatedBlob));
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Detection failed");
      } finally {
        setLoading(false);
      }
    },
    [multiMode, conf, selectedCkpts]
  );

  const handleClear = () => {
    setOriginalSrc(null);
    setAnnotatedSrc(null);
    setMultiResults([]);
    setError(null);
  };

  const hasResults = originalSrc != null;

  return (
    <div className="w-full">
      <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 pb-12 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 mb-2">
              <IconScan className="size-7" /> YOLO Detection
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload an image to run person detection and compare results across node checkpoints.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!modelLoaded && (
              <Badge variant="destructive" className="flex items-center gap-1 whitespace-nowrap">
                <IconAlertTriangle className="size-3" /> Model not loaded
              </Badge>
            )}
            {modelLoaded && <Badge variant="outline" className="flex items-center gap-1 border-green-500 text-green-600 whitespace-nowrap"><IconCircleCheck className="size-3" /> Model ready</Badge>}
          </div>
        </div>
      </div>

      {/* Mode toggle + settings */}
      <Card className="border-2">
        <CardHeader className="pb-6">
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-2 p-1 rounded-lg border bg-muted/40">
              <button
                onClick={() => setMultiMode(false)}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${!multiMode ? "bg-white dark:bg-slate-950 text-primary shadow-sm border border-primary/20" : "text-muted-foreground hover:text-foreground"}`}
              >
                Single
              </button>
              <button
                onClick={() => setMultiMode(true)}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${multiMode ? "bg-white dark:bg-slate-950 text-primary shadow-sm border border-primary/20" : "text-muted-foreground hover:text-foreground"}`}
              >
                Compare All
              </button>
            </div>
            
            {/* Confidence slider */}
            <div>
              <ConfSlider value={conf} onChange={setConf} />
            </div>
          </div>
        </CardHeader>
        {multiMode && (
          <CardContent className="pt-0 space-y-4 border-t">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Checkpoints to Compare</p>
              <Button variant="ghost" size="sm" onClick={refreshCheckpoints} className="gap-1.5 h-8 text-xs">
                <IconRefresh className="size-3.5" /> Refresh
              </Button>
            </div>
            <CardDescription className="text-xs">
              Each selected checkpoint runs inference independently — results appear side-by-side.
            </CardDescription>
            <CheckpointSelector
              checkpoints={checkpoints}
              selected={selectedCkpts}
              onToggle={toggleCheckpoint}
              onSelectAll={selectAll}
              loading={ckptLoading}
            />
          </CardContent>
        )}
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-lg border-l-4 border-l-destructive bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-3">
          <IconAlertTriangle className="size-5 mt-0.5 shrink-0 flex-none" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {/* Upload zone (when no image loaded) */}
      {!hasResults && <DropZone onFile={handleFile} disabled={!modelLoaded} />}

      {/* Results */}
      {hasResults && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Detection Results</h2>
              <p className="text-sm text-muted-foreground mt-1">Results from {multiMode ? 'selected nodes' : 'single checkpoint'}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1.5 h-9">
              <IconX className="size-4" /> Clear
            </Button>
          </div>

          {/* ── Single mode ── */}
          {!multiMode && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card className="flex flex-col overflow-hidden border-2">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Original Image</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center pt-6">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={originalSrc!} alt="Original" className="w-full rounded-lg object-contain max-h-96" />
                </CardContent>
              </Card>
              <Card className="flex flex-col overflow-hidden border-2">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Detection Results</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center pt-6">
                  {loading ? (
                    <div className="flex h-64 items-center justify-center gap-3 flex-col text-muted-foreground">
                      <IconLoader2 className="size-8 animate-spin text-primary" />
                      <p className="text-sm font-medium">Running inference…</p>
                    </div>
                  ) : annotatedSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={annotatedSrc} alt="Annotated" className="w-full rounded-lg object-contain max-h-96" />
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Multi-node mode ── */}
          {multiMode && (
            <div className="space-y-6">
              {/* Original image */}
              <Card className="lg:max-w-md border-2 overflow-hidden">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Input Image</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={originalSrc!} alt="Input" className="w-full rounded-lg object-contain max-h-72" />
                </CardContent>
              </Card>

              {/* Node result grid */}
              {loading ? (
                <div className="flex items-center gap-3 text-muted-foreground py-12 justify-center">
                  <IconLoader2 className="size-6 animate-spin text-primary" />
                  <p className="text-sm font-medium">Running inference across {selectedCkpts.size} checkpoint{selectedCkpts.size !== 1 ? "s" : ""}…</p>
                </div>
              ) : multiResults.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{multiResults.length} Node Results</h3>
                    </div>
                    <Badge variant="outline" className="text-base px-3 py-1">
                      {multiResults.reduce((s, r) => s + r.person_count, 0)} total persons detected
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {multiResults.map((r, i) => (
                      <NodeResultCard key={i} result={r} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Upload another */}
          <div className="pt-4">
            <h3 className="text-sm font-semibold mb-4">Upload Another Image</h3>
            <DropZone onFile={handleFile} disabled={!modelLoaded} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
