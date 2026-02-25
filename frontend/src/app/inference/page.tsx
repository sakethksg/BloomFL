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
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-muted-foreground w-36 shrink-0">
        Confidence threshold
      </label>
      <input
        type="range" min={0.01} max={1} step={0.01} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1"
      />
      <span className="text-sm font-mono w-10 text-right">{(value * 100).toFixed(0)}%</span>
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
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer select-none",
        dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
        disabled ? "opacity-50 cursor-not-allowed" : "",
      ].join(" ")}
    >
      <IconUpload className="size-8 text-muted-foreground" />
      <div className="text-center">
        <p className="text-sm font-medium">Drop an image here or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">JPEG · PNG · WebP · BMP</p>
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
    ? <Badge variant="destructive">Error</Badge>
    : result.person_count > 0
    ? <Badge className="bg-green-600">{result.person_count} person{result.person_count !== 1 ? "s" : ""}</Badge>
    : <Badge variant="secondary">No persons</Badge>;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-mono">{result.node_label}</CardTitle>
          <div className="flex items-center gap-2">
            {hasBadge}
            <span className="text-xs text-muted-foreground font-mono">
              {result.inference_time_ms.toFixed(1)} ms
            </span>
          </div>
        </div>
        <CardDescription className="truncate text-xs">{result.model_path}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {result.error ? (
          <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{result.error}</div>
        ) : (
          <>
            {result.annotated_jpeg_b64 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/jpeg;base64,${result.annotated_jpeg_b64}`}
                alt={`Detection result for ${result.node_label}`}
                className="w-full rounded-md object-contain max-h-56"
              />
            )}
            <div className="text-xs text-muted-foreground">
              {result.boxes.length} object{result.boxes.length !== 1 ? "s" : ""} detected
            </div>
            {result.boxes.length > 0 && (
              <div className="rounded-md border overflow-auto max-h-36">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Class</TableHead>
                      <TableHead>Conf</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.boxes.map((box, i) => (
                      <TableRow key={i} className={box.class_id === 0 ? "bg-green-500/5" : ""}>
                        <TableCell className={box.class_id === 0 ? "font-semibold text-green-600 dark:text-green-400 text-xs" : "text-muted-foreground text-xs"}>
                          {box.class_name}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{(box.conf * 100).toFixed(1)}%</TableCell>
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
    <div className="space-y-6 px-4 lg:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IconScan className="size-6" /> YOLO Detection
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload an image to run person detection and compare results across node checkpoints.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!modelLoaded && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <IconAlertTriangle className="size-3" /> Model not loaded
            </Badge>
          )}
          {modelLoaded && <Badge variant="outline" className="flex items-center gap-1 border-green-500 text-green-600"><IconCircleCheck className="size-3" /> Model ready</Badge>}
        </div>
      </div>

      {/* Mode toggle + settings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1 rounded-lg border p-1">
              <button
                onClick={() => setMultiMode(false)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${!multiMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Single checkpoint
              </button>
              <button
                onClick={() => setMultiMode(true)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${multiMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Compare all nodes
              </button>
            </div>
            <ConfSlider value={conf} onChange={setConf} />
          </div>
        </CardHeader>
        {multiMode && (
          <CardContent className="pt-0 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Checkpoints to compare</p>
              <Button variant="ghost" size="sm" onClick={refreshCheckpoints} className="gap-1.5 h-7 text-xs">
                <IconRefresh className="size-3" /> Refresh
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
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-2">
          <IconAlertTriangle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Upload zone (when no image loaded) */}
      {!hasResults && <DropZone onFile={handleFile} disabled={!modelLoaded} />}

      {/* Results */}
      {hasResults && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Results</h2>
            <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1.5">
              <IconX className="size-4" /> Clear
            </Button>
          </div>

          {/* ── Single mode ── */}
          {!multiMode && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Original</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={originalSrc!} alt="Original" className="w-full rounded-md object-contain max-h-96" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Annotated</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                      <IconLoader2 className="size-5 animate-spin" /> Running inference…
                    </div>
                  ) : annotatedSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={annotatedSrc} alt="Annotated" className="w-full rounded-md object-contain max-h-96" />
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Multi-node mode ── */}
          {multiMode && (
            <>
              {/* Original image */}
              <Card className="sm:max-w-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Input image</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={originalSrc!} alt="Input" className="w-full rounded-md object-contain max-h-64" />
                </CardContent>
              </Card>

              {/* Node result grid */}
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                  <IconLoader2 className="size-5 animate-spin" />
                  Running inference across {selectedCkpts.size} node checkpoint{selectedCkpts.size !== 1 ? "s" : ""}…
                </div>
              ) : multiResults.length > 0 ? (
                <>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium">{multiResults.length} node results</p>
                    <Badge variant="outline">
                      {multiResults.reduce((s, r) => s + r.person_count, 0)} total persons detected
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {multiResults.map((r, i) => (
                      <NodeResultCard key={i} result={r} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}

          {/* Upload another */}
          <Card>
            <CardContent className="pt-4">
              <DropZone onFile={handleFile} disabled={!modelLoaded} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
