"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Utterance } from "@/lib/cashier";
import { CashierController } from "./use-cashier";

export function useCashierVoice(cashier: CashierController) {
  const [phase, setPhase] = useState<
    "idle" | "permission" | "listening" | "transcribing" | "speaking"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [readReplies, setReadReplies] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const spoken = useRef<string | null>(null);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const speak = useCallback((text: string, language: string) => {
    if (!("speechSynthesis" in window)) {
      setError(
        "Spoken replies are unavailable in this browser. You can read every reply here.",
      );
      return;
    }
    speech.current = null;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "tr" ? "tr-TR" : "en-US";
    speech.current = utterance;
    utterance.onstart = () => {
      if (active.current && speech.current === utterance) setPhase("speaking");
    };
    utterance.onend = () => {
      if (active.current && speech.current === utterance) {
        speech.current = null;
        setPhase("idle");
      }
    };
    utterance.onerror = (e) => {
      if (active.current && speech.current === utterance) {
        speech.current = null;
        setPhase("idle");
        if (!["canceled", "interrupted"].includes(e.error))
          setError(
            "The browser could not speak this reply. Read it or choose a system voice in browser settings.",
          );
      }
    };
    window.speechSynthesis.speak(utterance);
  }, []);
  const latest = cashier.session?.messages.at(-1);
  useEffect(() => {
    if (
      !readReplies ||
      !latest ||
      latest.role !== "assistant" ||
      latest.source === "configuration" ||
      latest.id === spoken.current ||
      phase === "listening" ||
      phase === "transcribing" ||
      phase === "permission"
    )
      return;
    spoken.current = latest.id;
    speak(latest.text, cashier.session?.job.primaryLanguage || "en");
  }, [latest, readReplies, phase, speak, cashier.session?.job.primaryLanguage]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
    };
  }, []);
  async function recognize(blob: Blob) {
    const credentials = cashier.credentials;
    if (!credentials || !active.current) return;
    setPhase("transcribing");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const base = `/api/cashier/sessions/${credentials.id}/utterances`;
      const headers = { Authorization: `Bearer ${credentials.token}` };
      const response = await fetch(base, {
        method: "POST",
        headers: { ...headers, "Content-Type": blob.type },
        body: blob,
        signal: abort.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not send the recording.");
      let job: Utterance = result.utterance;
      const deadline = Date.now() + 180000;
      while (["queued", "processing"].includes(job.status)) {
        if (Date.now() > deadline)
          throw new Error(
            "Recognition is still queued. A video may be using Whisper. Use text for now and keep the worker running.",
          );
        await new Promise<void>((resolve, reject) => {
          const cancel = () => {
            clearTimeout(id);
            reject(new DOMException("Aborted", "AbortError"));
          };
          const id = setTimeout(() => {
            abort.signal.removeEventListener("abort", cancel);
            resolve();
          }, 700);
          abort.signal.addEventListener("abort", cancel, { once: true });
        });
        const check = await fetch(`${base}/${job.id}`, {
          headers,
          cache: "no-store",
          signal: abort.signal,
        });
        const data = await check.json();
        if (!check.ok)
          throw new Error(data.error || "Could not read recognized speech.");
        job = data.utterance;
      }
      if (job.status !== "completed" || !job.text)
        throw new Error(
          job.error?.message ||
            "No speech was recognized. Try typing your order.",
        );
      if (
        active.current &&
        !abort.signal.aborted &&
        controller.current === abort
      ) {
        setTranscript(job.text);
        const sent = await cashier.send(job.text, "voice", job.id);
        if (!sent)
          throw new Error(
            "Speech was recognized but could not be sent. Your transcript is shown below; review the cart before retrying.",
          );
      }
    } catch (e) {
      if (
        active.current &&
        !abort.signal.aborted &&
        controller.current === abort
      )
        setError(
          e instanceof Error
            ? e.message
            : "Speech recognition failed. Use the text input.",
        );
    } finally {
      if (controller.current === abort) {
        if (active.current) setPhase("idle");
        controller.current = null;
      }
    }
  }
  async function toggle() {
    if (phase === "listening") {
      if (timer.current) clearTimeout(timer.current);
      recorder.current?.stop();
      return;
    }
    if (
      ["permission", "transcribing"].includes(phase) ||
      cashier.busy ||
      cashier.session?.processing
    )
      return;
    setError(null);
    setTranscript(null);
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Microphone recording requires a supported browser on localhost or HTTPS. You can always type your order.",
      );
      return;
    }
    speech.current = null;
    window.speechSynthesis?.cancel();
    setPhase("permission");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime)
        throw new Error(
          "This browser cannot record a supported audio format. Try Chrome, Edge, Firefox, or use text.",
        );
      const recording = new MediaRecorder(media, { mimeType: mime });
      recorder.current = recording;
      const chunks: BlobPart[] = [];
      recording.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recording.onerror = () => {
        recording.onstop = null;
        if (active.current) {
          setError("Microphone recording failed. Try again or use text.");
          setPhase("idle");
        }
        media.getTracks().forEach((t) => t.stop());
        if (timer.current) clearTimeout(timer.current);
      };
      recording.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        stream.current = null;
        recorder.current = null;
        if (timer.current) clearTimeout(timer.current);
        if (active.current) void recognize(new Blob(chunks, { type: mime }));
      };
      recording.start(250);
      setPhase("listening");
      timer.current = setTimeout(() => {
        if (recording.state === "recording") recording.stop();
      }, 30000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setPhase("idle");
      setError(
        e instanceof DOMException &&
          ["NotAllowedError", "SecurityError"].includes(e.name)
          ? "Microphone permission was denied. Allow it in your browser's site settings or type your order."
          : e instanceof Error
            ? e.message
            : "Could not open the microphone.",
      );
    }
  }
  function stopSpeaking() {
    speech.current = null;
    window.speechSynthesis?.cancel();
    setPhase("idle");
  }
  function cancelRecognition() {
    const previous = controller.current;
    controller.current = null;
    previous?.abort();
    setPhase("idle");
  }
  return {
    phase,
    error,
    transcript,
    readReplies,
    setReadReplies,
    toggle,
    speak: (text: string) =>
      speak(text, cashier.session?.job.primaryLanguage || "en"),
    stopSpeaking,
    cancelRecognition,
  };
}
