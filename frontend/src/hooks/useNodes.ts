"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { NodeState } from "@/lib/types";

export function useNodes() {
  const [nodes, setNodes] = useState<Map<string, NodeState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial snapshot via REST
  useEffect(() => {
    api.nodes
      .list()
      .then((list) => {
        setNodes(new Map(list.map((n) => [n.node_id, n])));
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });

    // Poll every 5 s as fallback
    const interval = setInterval(() => {
      api.nodes
        .list()
        .then((list) =>
          setNodes(new Map(list.map((n) => [n.node_id, n])))
        )
        .catch(() => {});
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Merge live WS pushes
  const handleMessage = useCallback((data: NodeState) => {
    setNodes((prev) => {
      const next = new Map(prev);
      next.set(data.node_id, data);
      return next;
    });
  }, []);

  const { status: wsStatus } = useWebSocket<NodeState>("nodes", handleMessage);

  return {
    nodes: Array.from(nodes.values()),
    nodesMap: nodes,
    loading,
    error,
    wsStatus,
  };
}
