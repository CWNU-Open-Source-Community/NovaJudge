"use client";

import { useState } from "react";
import {
  ArrowDownTrayIcon,
  CodeBracketIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

interface Props {
  contestId: number;
}

export default function ExportEventFeedButton({ contestId }: Props) {
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingGhost, setLoadingGhost] = useState(false);

  const download = async (
    url: string,
    filename: string,
    setLoading: (v: boolean) => void,
  ) => {
    try {
      setLoading(true);

      // 1. 尝试直接使用 Cookie 下载
      let response = await fetch(url);

      // 2. 如果 Cookie 验证失败 (401)，则弹出提示输入 CCS 账号密码
      if (response.status === 401) {
        setLoading(false); // 暂时取消 loading，因为要弹窗
        // 等待下一帧以确保 UI 更新
        await new Promise((resolve) => setTimeout(resolve, 0));

        const username = prompt(
          "Authentication required. Please enter CCS username (admin):",
          "admin",
        );
        if (!username) return;
        const password = prompt("Please enter CCS password:");
        if (!password) return;

        setLoading(true);
        const credentials = btoa(`${username}:${password}`);
        response = await fetch(url, {
          headers: {
            Authorization: `Basic ${credentials}`,
          },
        });
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Unauthorized: Invalid credentials");
        }
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2 ml-2">
      <button
        onClick={() =>
          download(
            `/api/ccs/contests/${contestId}/event-feed?stream=false&runs=false`,
            `event-feed-contest-${contestId}-${new Date()
              .toISOString()
              .replace(/[-:]/g, "")
              .replace(/\..+/, "")
              .replace("T", "-")}.ndjson`,
            setLoadingFeed,
          )
        }
        disabled={loadingFeed}
        className="flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
        title="Export Event Feed JSON"
      >
        <ArrowDownTrayIcon className="w-4 h-4" />
        {loadingFeed ? "Exporting..." : "Event Feed"}
      </button>

      <button
        onClick={() =>
          download(
            `/api/ccs/contests/${contestId}/ghost`,
            `contest-${contestId}-ghost.dat`,
            setLoadingGhost,
          )
        }
        disabled={loadingGhost}
        className="flex items-center gap-1 px-3 py-1 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
        title="Export Codeforces Gym Ghost File"
      >
        <CodeBracketIcon className="w-4 h-4" />
        {loadingGhost ? "Exporting..." : "Ghost DAT"}
      </button>
    </div>
  );
}
