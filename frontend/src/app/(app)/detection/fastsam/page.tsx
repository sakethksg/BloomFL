"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CheckpointInfo, NodeDetectionResult } from "@/lib/types";
import { formatCoords } from "@/lib/detection";
import { ConfSlider } from "@/components/detection/conf-slider";
import { DropZone } from "@/components/detection/drop-zone";
import { NodeResultCard } from "@/components/detection/node-result-card";
import { CheckpointSelector } from "@/components/detection/checkpoint-selector";
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
  IconX,
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconRefresh,
  IconPhotoEdit,
  IconLayersIntersect,
  IconPhoto,
  IconSearch,
  IconPlayerPlay,
} from "@tabler/icons-react";

// ── Main Page Component ───────────────────────────────────────────────────────

export default function FastSAMDetectionPage() {
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
  const [fastsamAvailable, setFastsamAvailable] = useState(true);

  useEffect(() => {
    api.inference.status().then((s) => setModelLoaded(s.model_loaded)).catch(() => {});
    
    // Check if FastSAM is actually available
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/inference/capabilities`)
      .then(r => r.json())
      .then(caps => setFastsamAvailable(caps.fastsam))
      .catch(() => setFastsamAvailable(false));
    
    fetchCheckpoints();
  }, []);

  const fetchCheckpoints = () => {
    setCkptLoading(true);
    api.inference.checkpoints("fastsam")
      .then((list) => {
        // Filter to only FastSAM models
        const fastsamModels = list.filter((c) => c.detection_type === "fastsam");
        setCheckpoints(fastsamModels);
        const existing = fastsamModels.filter((c) => c.exists).map((c) => c.path);
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
        setSingleResult(detectionData as any); 
        setAnnotatedSrc(URL.createObjectURL(annotatedBlob));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Segmentation failed. Please try again.");
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
              FastSAM Segmentation
            </h1>
            <p className="text-base text-muted-foreground max-w-xl">
              Fast segmentation of anything. Evaluate and compare FastSAM models side-by-side.
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

                {/* Confidence Threshold */}
                <ConfSlider 
                  value={conf} 
                  onChange={setConf}
                  label="Segmentation Threshold"
                />

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
            
            {/* FastSAM Availability Warning */}
            {!fastsamAvailable && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-600 dark:text-amber-500 flex items-start gap-3">
                <IconAlertTriangle className="size-5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">FastSAM Not Available</p>
                  <p className="text-xs opacity-90">
                    FastSAM library is not installed. Falling back to YOLO for inference. 
                    To use FastSAM, install it on the server: <code className="bg-amber-500/10 px-1 py-0.5 rounded">pip install fastsam</code>
                  </p>
                </div>
              </div>
            )}
            
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
                        {loading ? "Processing..." : multiMode ? "Comparison Complete" : "Segmentation Complete"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {multiMode 
                          ? `Evaluating ${selectedCkpts.size} model${selectedCkpts.size !== 1 ? "s" : ""}` 
                          : `Threshold: ${(conf * 100).toFixed(0)}%`}
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
                      Run Segmentation
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
                      <p className="font-medium">Running FastSAM segmentation...</p>
                   </div>
                ) : (
                  <>
                    {/* ── Single Mode View ── */}
                    {!multiMode && (
                      <div className="space-y-6">
                        <Card className="overflow-hidden border-muted shadow-sm">
                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x border-b">
                            <div className="p-3 bg-muted/20 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">Original Input</div>
                            <div className="p-3 bg-primary/5 text-center text-xs font-bold uppercase tracking-wider text-primary">Segmentation Output</div>
                          </div>
                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x bg-muted/5">
                            <div className="p-6 flex items-center justify-center min-h-[300px]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={originalSrc!} alt="Original" className="max-w-full rounded-lg shadow-sm max-h-[500px] object-contain" />
                            </div>
                            <div className="p-6 flex items-center justify-center min-h-[300px]">
                              {annotatedSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={annotatedSrc} alt="Segmentation Output" className="max-w-full rounded-lg shadow-sm max-h-[500px] object-contain" />
                              ) : (
                                <p className="text-muted-foreground text-sm">No segmentation generated.</p>
                              )}
                            </div>
                          </div>
                        </Card>

                        {/* Single Mode Table */}
                        <Card className="shadow-sm border-muted">
                          <CardHeader className="py-4 border-b bg-muted/10">
                            <CardTitle className="text-sm flex items-center gap-2">
                              Segmentation Results
                              {singleResult?.boxes && singleResult.boxes.length > 0 && (
                                <Badge className="ml-2 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">
                                  {singleResult.boxes.length} Objects
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
                                      <TableHead className="font-medium">Object</TableHead>
                                      <TableHead className="font-medium">Confidence</TableHead>
                                      <TableHead className="font-medium">Bounds</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {singleResult.boxes.map((box, i) => (
                                      <TableRow key={i} className="hover:bg-muted/50 transition-colors">
                                        <TableCell className="font-medium text-foreground">
                                          {box.class_name || `Object ${i + 1}`}
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
                                No segmentations found.
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
