import type {
  NodeState,
  RoundStats,
  Summary,
  SimulationStatus,
  SimulationStartRequest,
  SimulationResult,
  BloomFLConfig,
  DetectionResult,
  NodeDetectionResult,
  InferenceStatus,
  CheckpointInfo,
} from "./types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Nodes ──────────────────────────────────────────────────────────────────

export const api = {
  nodes: {
    list: () => get<NodeState[]>("/api/nodes"),
    get: (nodeId: string) => get<NodeState>(`/api/nodes/${nodeId}`),
    history: (nodeId: string) => get<NodeState[]>(`/api/nodes/${nodeId}/history`),
  },

  metrics: {
    summary: () => get<Summary>("/api/metrics/summary"),
    perRound: () => get<RoundStats[]>("/api/metrics/per-round"),
    exportUrl: () => `${BASE_URL}/api/metrics/export`,
  },

  simulation: {
    status: () => get<SimulationStatus>("/api/simulation/status"),
    start: (req: SimulationStartRequest) =>
      post<SimulationStatus>("/api/simulation/start", req),
    stop: () => post<SimulationStatus>("/api/simulation/stop"),
    results: () => get<SimulationResult>("/api/simulation/results"),
  },

  config: {
    get: () => get<BloomFLConfig>("/api/config"),
    patch: (changes: Record<string, unknown>) =>
      patch<BloomFLConfig>("/api/config", { changes }),
  },

  inference: {
    status: () => get<InferenceStatus>("/api/inference/status"),
    checkpoints: (detectionType?: string) => {
      const query = detectionType ? `?detection_type=${detectionType}` : "";
      return get<CheckpointInfo[]>(`/api/inference/checkpoints${query}`);
    },

    detect: (file: File, conf = 0.35, checkpoint = "") => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE_URL}/api/inference/detect?conf=${conf}&checkpoint=${encodeURIComponent(checkpoint)}`, {
        method: "POST",
        body: form,
      }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.detail ?? `${r.status}`)));
        return r.json() as Promise<DetectionResult>;
      });
    },

    detectAnnotated: (file: File, conf = 0.35, checkpoint = "") => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE_URL}/api/inference/detect/annotated?conf=${conf}&checkpoint=${encodeURIComponent(checkpoint)}`, {
        method: "POST",
        body: form,
      }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.detail ?? `${r.status}`)));
        return r.blob();
      });
    },

    detectMulti: (file: File, conf = 0.35, checkpoints: string[] = []) => {
      const form = new FormData();
      form.append("file", file);
      const ckptParam = checkpoints.length ? encodeURIComponent(checkpoints.join(",")) : "";
      return fetch(`${BASE_URL}/api/inference/detect/multi?conf=${conf}&checkpoints=${ckptParam}`, {
        method: "POST",
        body: form,
      }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.detail ?? `${r.status}`)));
        return r.json() as Promise<NodeDetectionResult[]>;
      });
    },

    detectMultiAnnotated: (file: File, conf = 0.35, checkpoints: string[] = []) => {
      const form = new FormData();
      form.append("file", file);
      const ckptParam = checkpoints.length ? encodeURIComponent(checkpoints.join(",")) : "";
      return fetch(`${BASE_URL}/api/inference/detect/multi/annotated?conf=${conf}&checkpoints=${ckptParam}`, {
        method: "POST",
        body: form,
      }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.detail ?? `${r.status}`)));
        return r.json() as Promise<NodeDetectionResult[]>;
      });
    },
  },
};

export const WS_BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
    .replace(/^http/, "ws");
