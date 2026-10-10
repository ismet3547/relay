"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { VideoJob, VideosState } from "@/lib/video";
import config from "../../config/transcription.json";

export function useVideos() {
  const [state, setState] = useState<VideosState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{
    filename: string;
    progress: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/videos", { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        "Could not load recordings. Check that Relay is running.",
      );
    const next = await response.json();
    setState(next);
    return next as VideosState;
  }, []);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch("/api/videos", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Could not load recordings. Check that Relay is running.",
          );
        const next = await response.json();
        if (mounted) setState(next);
      } catch (err) {
        if (mounted)
          setError(
            err instanceof Error ? err.message : "Could not load recordings.",
          );
      }
      if (mounted) timer = setTimeout(poll, config.pollIntervalMs);
    }
    void poll();
    return () => {
      mounted = false;
      controller.abort();
      clearTimeout(timer);
      xhr.current?.abort();
    };
  }, []);
  const uploadFile = useCallback(
    async (file: File, language: "auto" | "en" | "tr") => {
      setError(null);
      if (xhr.current) return null;
      if (state && file.size > state.limits.maxUploadBytes) {
        setError(
          `Choose a video smaller than ${state.limits.maxUploadBytes / 1048576} MB.`,
        );
        return null;
      }
      if (!/\.(mp4|mov|webm)$/i.test(file.name)) {
        setError("Choose an MP4, MOV, or WebM video.");
        return null;
      }
      setUpload({ filename: file.name, progress: 0 });
      const form = new FormData();
      form.append("language", language);
      form.append("video", file);
      return new Promise<VideoJob | null>((resolve) => {
        const request = new XMLHttpRequest();
        xhr.current = request;
        request.open("POST", "/api/videos");
        request.upload.onprogress = (event) => {
          if (event.lengthComputable)
            setUpload({
              filename: file.name,
              progress: Math.round((event.loaded / event.total) * 100),
            });
        };
        request.onload = () => {
          xhr.current = null;
          setUpload(null);
          try {
            const result = JSON.parse(request.responseText);
            if (request.status < 200 || request.status >= 300)
              throw new Error(result.error || "Video upload failed.");
            setState((previous) =>
              previous
                ? {
                    ...previous,
                    jobs: [
                      result.job,
                      ...previous.jobs.filter((j) => j.id !== result.job.id),
                    ],
                  }
                : previous,
            );
            void refresh().catch(() =>
              setError(
                "Video uploaded. Reload to reconnect to the recording list.",
              ),
            );
            resolve(result.job);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Video upload failed.",
            );
            resolve(null);
          }
        };
        request.onerror = request.onabort = () => {
          xhr.current = null;
          setUpload(null);
          setError("The upload was interrupted. Please try again.");
          resolve(null);
        };
        request.send(form);
      });
    },
    [refresh, state],
  );
  const action = useCallback(
    async (id: string, kind: "delete" | "retry") => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/videos/${id}${kind === "retry" ? "/retry" : ""}`,
          { method: kind === "retry" ? "POST" : "DELETE" },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not update this recording.");
        await refresh();
        return true;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not update this recording.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  return {
    state,
    error,
    clearError: () => setError(null),
    upload,
    uploadFile,
    action,
    busy,
  };
}
