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
  IconPhotoEdit,
  IconSettings2,
  IconLayersIntersect,
  IconPhoto,
  IconSearch,
  IconPlayerPlay,
} from "@tabler/icons-react";

// ── Helper to safely extract and format coordinates ───────────────────────────
const formatCoords = (box: any) => {
  // Handle x1, y1, x2, y2 format (current API response)
  if (typeof box.x1 === "number" && typeof box.y1 === "number" && 
      typeof box.x2 === "number" && typeof box.y2 === "number") {
    return `[${Math.round(box.x1)}, ${Math.round(box.y1)}, ${Math.round(box.x2)}, ${Math.round(box.y2)}]`;
  }
  // Handle bbox array format
  if (box.bbox && Array.isArray(box.bbox)) {
    return `[${box.bbox.map((v: number) => Math.round(v)).join(", ")}]`;
  }
  // Handle x, y, w, h format
  if (typeof box.x === "number") {
    return `[${Math.round(box.x)}, ${Math.round(box.y)}, ${Math.round(box.w)}, ${Math.round(box.h)}]`;
  }
  return "N/A";
};

// ── UI Components ─────────────────────────────────────────────────────────────

function ConfSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          <IconSettings2 className="size-4 text-muted-foreground" />
          Confidence
        </label>
        <Badge variant="secondary" className="font-mono">{Math.round(value * 100)}%</Badge>
      </div>
      <input
        type="range"
        min={0.01}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

function DropZone({ onFile, disabled, compact = false }: { onFile: (f: File) => void; disabled?: boolean; compact?: boolean }) {
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
      className={`
        relative overflow-hidden group flex flex-col items-center justify-center transition-all cursor-pointer select-none
        border-2 border-dashed rounded-2xl
        ${dragging ? "border-primary bg-primary/5 scale-[1.02]" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"}
        ${disabled ? "opacity-50 cursor-not-allowed hover:scale-100" : ""}
        ${compact ? "p-8 py-10" : "p-12 py-20"}
      `}
    >
      <div className={`rounded-full flex items-center justify-center bg-background shadow-sm border mb-4 transition-transform group-hover:-translate-y-1 ${compact ? "size-12" : "size-16"}`}>
        <IconUpload className={`text-muted-foreground group-hover:text-primary transition-colors ${compact ? "size-5" : "size-7"}`} />
      </div>
      <div className="text-center space-y-1 relative z-10">
        <p className={`${compact ? "text-sm" : "text-base"} font-semibold text-foreground`}>
          Click or drag image to upload
        </p>
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP up to 10MB</p>
      </div>
      <input
        ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = ""; } }}
      />
    </div>
  );
}

function NodeResultCard({ result }: { result: NodeDetectionResult }) {
  return (
    <Card className="overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="p-4 border-b bg-muted/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <CardTitle className="text-sm font-semibold truncate flex items-center gap-2">
              <IconLayersIntersect className="size-4 text-primary" />
              {result.node_label}
            </CardTitle>
            <CardDescription className="truncate text-xs font-mono">{result.model_path}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {result.error ? (
              <Badge variant="destructive" className="text-[10px] h-5">Failed</Badge>
            ) : result.person_count > 0 ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200 text-[10px] h-5">
                {result.person_count} Detections
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] h-5">No objects</Badge>
            )}
            <span className="text-[10px] text-muted-foreground font-mono">
              {result.inference_time_ms.toFixed(1)}ms
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 flex flex-col bg-muted/5">
        {result.error ? (
          <div className="p-4 m-4 rounded-lg bg-destructive/10 text-sm text-destructive font-medium border border-destructive/20 flex items-start gap-2">
             <IconAlertTriangle className="size-4 shrink-0 mt-0.5" />
             {result.error}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {result.annotated_jpeg_b64 && (
              <div className="p-4 pb-2 flex items-center justify-center bg-background border-b">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${result.annotated_jpeg_b64}`}
                  alt={`Detection result for ${result.node_label}`}
                  className="w-full rounded-md object-contain max-h-[220px]"
                />
              </div>
            )}
            
            {result.boxes.length > 0 ? (
              <div className="overflow-auto max-h-[200px] custom-scrollbar">
                <Table>
                  <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-medium h-8">Person</TableHead>
                      <TableHead className="text-xs font-medium h-8">Confidence</TableHead>
                      <TableHead className="text-xs font-medium h-8 text-right">Coordinates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.boxes.map((box, i) => (
                      <TableRow key={i} className="h-8 hover:bg-muted/50">
                        <TableCell className="py-1 text-xs font-medium text-foreground">
                           Person {i + 1}
                        </TableCell>
                        <TableCell className="py-1 font-mono text-xs text-muted-foreground">
                          {(box.conf * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="py-1 font-mono text-xs text-right text-muted-foreground">
                          {formatCoords(box)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted-foreground">
                No detections found.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
  if (loading) return <Skeleton className="h-[200px] w-full rounded-xl" />;
  if (!checkpoints.length) return (
    <div className="text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg text-center border border-dashed">
      No checkpoints found.
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {selected.size} / {checkpoints.length} selected
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs hover:bg-muted" onClick={onSelectAll}>
          {selected.size === checkpoints.length ? "Clear All" : "Select All"}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
        {checkpoints.map((ckpt) => (
          <label
            key={ckpt.path}
            className={`
              flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all duration-200
              ${selected.has(ckpt.path) ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/30 hover:bg-muted/30"}
              ${!ckpt.exists ? "opacity-50 grayscale cursor-not-allowed" : ""}
            `}
          >
            <input
              type="checkbox"
              className="size-4 rounded border-muted accent-primary focus:ring-primary/20"
              checked={selected.has(ckpt.path)}
              disabled={!ckpt.exists}
              onChange={() => onToggle(ckpt.path)}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ckpt.label}</p>
            </div>
            {ckpt.is_pretrained && <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">base</Badge>}
            {!ckpt.exists && <IconAlertTriangle className="size-4 text-destructive shrink-0" />}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Main Page Component ───────────────────────────────────────────────────────

export default function InferencePage() {
  const [conf, setConf] = useState(0.35);
  const [multiMode, setMultiMode] = useState(false);
  const newImageInputRef = useRef<HTMLInputElement>(null);

  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [ckptLoading, setCkptLoading] = useState(true);
  const [selectedCkpts, setSelectedCkpts] = useState<Set<string>>(new Set());
  const [singleModeCheckpoint, setSingleModeCheckpoint] = useState<string>("");

  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  
  // Single Mode Data
  const [singleResult, setSingleResult] = useState<NodeDetectionResult | null>(null);
  const [annotatedSrc, setAnnotatedSrc] = useState<string | null>(null);
  
  // Multi Mode Data
  const [multiResults, setMultiResults] = useState<NodeDetectionResult[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(true);

  useEffect(() => {
    api.inference.status().then((s) => setModelLoaded(s.model_loaded)).catch(() => {});
    fetchCheckpoints();
  }, []);

  const fetchCheckpoints = () => {
    setCkptLoading(true);
    api.inference.checkpoints()
      .then((list) => {
        setCheckpoints(list);
        const existing = list.filter((c) => c.exists).map((c) => c.path);
        setSelectedCkpts(new Set(existing));
        if (existing.length > 0 && !singleModeCheckpoint) {
          setSingleModeCheckpoint(existing[0]);
        }
      })
      .catch(() => {})
      .finally(() => setCkptLoading(false));
  };

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

  const executeInference = async (file: File) => {
    if (!file) return;
    setError(null);
    setLoading(true);
    setMultiResults([]);
    setAnnotatedSrc(null);
    setSingleResult(null);

    try {
      if (multiMode) {
        const selected = Array.from(selectedCkpts);
        if (!selected.length) {
          setError("Please select at least one checkpoint to compare.");
          setLoading(false);
          return;
        }
        const results = await api.inference.detectMultiAnnotated(file, conf, selected);
        setMultiResults(results);
      } else {
        const [detectionData, annotatedBlob] = await Promise.all([
          api.inference.detect(file, conf, singleModeCheckpoint),
          api.inference.detectAnnotated(file, conf, singleModeCheckpoint),
        ]);
        // Expecting api.inference.detect to return the raw result data with boxes.
        // If your API returns an array, you may need detectionData[0] or similar.
        setSingleResult(detectionData as any); 
        setAnnotatedSrc(URL.createObjectURL(annotatedBlob));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Detection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleFile = useCallback(
    (file: File) => {
      setCurrentFile(file);
      setOriginalSrc(URL.createObjectURL(file));
      executeInference(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [multiMode, conf, selectedCkpts, singleModeCheckpoint]
  );

  const handleRunInferenceClick = () => {
    if (currentFile) {
      executeInference(currentFile);
    }
  };

  const handleClear = () => {
    setCurrentFile(null);
    setOriginalSrc(null);
    setAnnotatedSrc(null);
    setSingleResult(null);
    setMultiResults([]);
    setError(null);
  };

  const hasResults = originalSrc != null;

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      <div className="mx-auto max-w-[1400px] px-4 md:px-8 py-8 space-y-8">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-xl">
                <IconScan className="size-7 text-primary" />
              </div>
              YOLO Inference Engine
            </h1>
            <p className="text-base text-muted-foreground max-w-xl">
              Run real-time object detection and evaluate model checkpoints side-by-side.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 bg-muted/50 p-1.5 rounded-lg border">
            {modelLoaded ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10 border-emerald-200 py-1 px-3">
                <IconCircleCheck className="size-3.5 mr-1.5" /> Engine Online
              </Badge>
            ) : (
              <Badge variant="destructive" className="py-1 px-3">
                <IconAlertTriangle className="size-3.5 mr-1.5" /> Engine Offline
              </Badge>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr] gap-8 items-start">
          
          {/* Left Sidebar (Sticky Controls) */}
          <aside className="sticky top-8 space-y-6">
            <Card className="shadow-sm border-muted">
              <CardContent className="p-5 space-y-6">
                
                {/* Mode Selector */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Inference Mode</label>
                  <div className="flex p-1 rounded-xl bg-muted/50 border">
                    <button
                      onClick={() => setMultiMode(false)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${!multiMode ? "bg-background text-foreground shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    >
                      <IconPhoto className="size-4" /> Single
                    </button>
                    <button
                      onClick={() => setMultiMode(true)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${multiMode ? "bg-background text-foreground shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    >
                      <IconLayersIntersect className="size-4" /> Compare
                    </button>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Slider */}
                <ConfSlider value={conf} onChange={setConf} />

                {/* Single-mode Checkpoint Selector */}
                {!multiMode && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foreground">Model</label>
                        <Button variant="ghost" size="icon" onClick={fetchCheckpoints} className="size-7" title="Refresh Models">
                          <IconRefresh className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                      {ckptLoading ? (
                        <Skeleton className="h-[120px] w-full rounded-lg" />
                      ) : checkpoints.length > 0 ? (
                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                          {checkpoints.filter((c) => c.exists).map((ckpt) => (
                            <label
                              key={ckpt.path}
                              className={`
                                flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all duration-200
                                ${singleModeCheckpoint === ckpt.path ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/30 hover:bg-muted/30"}
                              `}
                            >
                              <input
                                type="radio"
                                name="checkpoint"
                                className="size-4 rounded-full border-muted accent-primary focus:ring-primary/20"
                                checked={singleModeCheckpoint === ckpt.path}
                                onChange={() => setSingleModeCheckpoint(ckpt.path)}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{ckpt.label}</p>
                              </div>
                              {ckpt.is_pretrained && <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">base</Badge>}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded-lg text-center border border-dashed">
                          No models available.
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Multi-mode Checkpoints (Conditional) */}
                {multiMode && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foreground">Active Models</label>
                        <Button variant="ghost" size="icon" onClick={fetchCheckpoints} className="size-7" title="Refresh Models">
                          <IconRefresh className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                      <CheckpointSelector
                        checkpoints={checkpoints}
                        selected={selectedCkpts}
                        onToggle={toggleCheckpoint}
                        onSelectAll={selectAll}
                        loading={ckptLoading}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </aside>

          {/* Right Workspace Area */}
          <main className="min-w-0 flex flex-col gap-6">
            
            {/* Global Errors */}
            {error && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                <IconAlertTriangle className="size-5 shrink-0" />
                <p className="font-semibold">{error}</p>
              </div>
            )}

            {!hasResults ? (
              /* Empty State Upload */
              <div className="h-[400px] flex items-center justify-center">
                <div className="w-full max-w-2xl">
                   <DropZone onFile={handleFile} disabled={!modelLoaded} />
                </div>
              </div>
            ) : (
              /* Results View */
              <div className="space-y-6 animate-in fade-in duration-500">
                
                {/* Action Bar */}
                <div className="flex flex-wrap items-center justify-between bg-muted/30 border rounded-xl p-3 px-4 shadow-sm gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative group size-12 rounded-lg overflow-hidden border bg-background shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={originalSrc!} alt="Input" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconSearch className="size-4 text-white" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold leading-none">
                        {loading ? "Processing..." : multiMode ? "Comparison Complete" : "Inference Complete"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {multiMode 
                          ? `Evaluating ${selectedCkpts.size} model${selectedCkpts.size !== 1 ? "s" : ""}` 
                          : `Confidence Threshold: ${(conf * 100).toFixed(0)}%`}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <Button 
                      onClick={handleRunInferenceClick} 
                      disabled={loading || !currentFile} 
                      className="gap-2"
                    >
                      {loading ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlayerPlay className="size-4" />}
                      Run Inference
                    </Button>

                    <div className="w-px h-6 bg-border mx-1 hidden sm:block"></div>

                    <input ref={newImageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.target.value = ""; } }} />
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => newImageInputRef.current?.click()} disabled={loading}>
                      <IconPhotoEdit className="size-4" /> Change Image
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleClear} className="gap-2 text-muted-foreground hover:text-destructive" disabled={loading}>
                      <IconX className="size-4" /> Clear
                    </Button>
                  </div>
                </div>

                {/* Loading State Overlay / Skeleton */}
                {loading ? (
                   <div className="h-[400px] rounded-2xl border-2 border-dashed border-muted flex flex-col items-center justify-center gap-4 text-muted-foreground bg-muted/10">
                      <IconLoader2 className="size-10 animate-spin text-primary" />
                      <p className="font-medium">Running inference algorithms...</p>
                   </div>
                ) : (
                  <>
                    {/* ── Single Mode View ── */}
                    {!multiMode && (
                      <div className="space-y-6">
                        <Card className="overflow-hidden border-muted shadow-sm">
                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x border-b">
                            <div className="p-3 bg-muted/20 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">Original Input</div>
                            <div className="p-3 bg-primary/5 text-center text-xs font-bold uppercase tracking-wider text-primary">Annotated Output</div>
                          </div>
                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x bg-muted/5">
                            <div className="p-6 flex items-center justify-center min-h-[300px]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={originalSrc!} alt="Original" className="max-w-full rounded-lg shadow-sm max-h-[500px] object-contain" />
                            </div>
                            <div className="p-6 flex items-center justify-center min-h-[300px]">
                              {annotatedSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={annotatedSrc} alt="Annotated Output" className="max-w-full rounded-lg shadow-sm max-h-[500px] object-contain" />
                              ) : (
                                <p className="text-muted-foreground text-sm">No annotations generated.</p>
                              )}
                            </div>
                          </div>
                        </Card>

                        {/* Single Mode Table */}
                        <Card className="shadow-sm border-muted">
                          <CardHeader className="py-4 border-b bg-muted/10">
                            <CardTitle className="text-sm flex items-center gap-2">
                              Detection Results
                              {singleResult?.boxes && singleResult.boxes.length > 0 && (
                                <Badge className="ml-2 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">
                                  {singleResult.boxes.length} Found
                                </Badge>
                              )}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-0">
                            {singleResult && singleResult.boxes && singleResult.boxes.length > 0 ? (
                              <div className="overflow-auto max-h-[300px] custom-scrollbar">
                                <Table>
                                  <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                                    <TableRow className="hover:bg-transparent">
                                      <TableHead className="font-medium">Person</TableHead>
                                      <TableHead className="font-medium">Confidence</TableHead>
                                      <TableHead className="font-medium">Coordinates</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {singleResult.boxes.map((box, i) => (
                                      <TableRow key={i} className="hover:bg-muted/50 transition-colors">
                                        <TableCell className="font-medium text-foreground">
                                          Person {i + 1}
                                        </TableCell>
                                        <TableCell className="font-mono text-muted-foreground">
                                          {(box.conf * 100).toFixed(1)}%
                                        </TableCell>
                                        <TableCell className="font-mono text-muted-foreground">
                                          {formatCoords(box)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : (
                              <div className="p-8 text-center text-sm text-muted-foreground">
                                No detections found matching the current confidence threshold.
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {/* ── Multi Mode View ── */}
                    {multiMode && multiResults.length > 0 && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {multiResults.map((result, i) => (
                          <NodeResultCard key={i} result={result} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}