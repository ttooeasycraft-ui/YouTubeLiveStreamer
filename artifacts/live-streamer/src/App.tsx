import { useState, useRef, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useGetStreamStatus,
  useStartStream,
  useStopStream,
  useDeleteVideo,
  useListVideos,
  getGetStreamStatusQueryKey,
  getListVideosQueryKey,
  setBaseUrl,
} from "@workspace/api-client-react";

const queryClient = new QueryClient();
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const IS_GITHUB_PAGES = window.location.hostname.includes("github.io");

function getSavedBackendUrl(): string {
  return localStorage.getItem("backendUrl") || "";
}

function normalizeBackendUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function applyBackendUrl(url: string) {
  const normalized = normalizeBackendUrl(url);
  if (normalized) {
    localStorage.setItem("backendUrl", normalized);
    setBaseUrl(normalized);
  } else {
    localStorage.removeItem("backendUrl");
    setBaseUrl(null);
  }
}

const initialBackendUrl = getSavedBackendUrl();
if (initialBackendUrl) {
  setBaseUrl(initialBackendUrl);
}

const ACCENT_COLORS = [
  { name: "YouTube Red", value: "#FF0000" },
  { name: "Ocean Blue", value: "#2563EB" },
  { name: "Neon Purple", value: "#7C3AED" },
  { name: "Emerald", value: "#059669" },
  { name: "Sunset Orange", value: "#EA580C" },
  { name: "Hot Pink", value: "#DB2777" },
  { name: "Cyan", value: "#0891B2" },
  { name: "Gold", value: "#D97706" },
];

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDuration(startedAt: string | null) {
  if (!startedAt) return "00:00:00";
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const h = Math.floor(diff / 3600).toString().padStart(2, "0");
  const m = Math.floor((diff % 3600) / 60).toString().padStart(2, "0");
  const s = (diff % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getScheduleTargetDate(timeStr: string): Date | null {
  if (!timeStr) return null;
  const [hh, mm] = timeStr.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;
  const target = new Date();
  target.setHours(hh, mm, 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  return target;
}

function formatCountdown(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function StreamerApp() {
  const qc = useQueryClient();

  const [accent, setAccent] = useState(() => localStorage.getItem("accent") || "#FF0000");
  const [showSettings, setShowSettings] = useState(false);
  const [backendUrl, setBackendUrlState] = useState(getSavedBackendUrl);
  const [backendUrlDraft, setBackendUrlDraft] = useState(getSavedBackendUrl);
  const [streamKey, setStreamKey] = useState("");
  const [selectedVideo, setSelectedVideo] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [format, setFormat] = useState<"landscape" | "shorts">("landscape");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [elapsed, setElapsed] = useState("00:00:00");

  // Schedule
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleCountdown, setScheduleCountdown] = useState("");
  const [scheduleActive, setScheduleActive] = useState(false);
  const scheduleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-restart
  const [autoRestart, setAutoRestart] = useState(() => localStorage.getItem("autoRestart") === "true");
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStreaming = useRef<boolean | null>(null);
  const lastStartParams = useRef<{ streamKey: string; videoFile: string; format: "landscape" | "shorts" } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-rgb", hexToRgb(accent));
    document.documentElement.style.setProperty("--accent", accent);
    localStorage.setItem("accent", accent);
  }, [accent]);

  useEffect(() => {
    localStorage.setItem("autoRestart", String(autoRestart));
  }, [autoRestart]);

  const needsBackendSetup = IS_GITHUB_PAGES && !backendUrl;

  const { data: status } = useGetStreamStatus({
    query: { queryKey: getGetStreamStatusQueryKey(), refetchInterval: 3000, enabled: !needsBackendSetup },
  });

  const { data: videos } = useListVideos({
    query: { queryKey: getListVideosQueryKey(), enabled: !needsBackendSetup },
  });

  const startMutation = useStartStream({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() }),
    },
  });

  const stopMutation = useStopStream({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() }),
    },
  });

  const deleteMutation = useDeleteVideo({
    mutation: {
      onSuccess: (_data, { filename }) => {
        qc.invalidateQueries({ queryKey: getListVideosQueryKey() });
        if (selectedVideo === filename) setSelectedVideo("");
      },
    },
  });

  const startTimer = useCallback((startedAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(formatDuration(startedAt)), 1000);
  }, []);

  const isStreaming = status?.isStreaming ?? false;

  useEffect(() => {
    if (isStreaming && status?.startedAt) {
      startTimer(status.startedAt);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsed("00:00:00");
    }
  }, [isStreaming, status?.startedAt, startTimer]);

  // Auto-restart logic
  useEffect(() => {
    if (prevStreaming.current === null) {
      prevStreaming.current = isStreaming;
      return;
    }

    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;

    // Stream dropped (was streaming, now stopped, has error, autoRestart on)
    if (wasStreaming && !isStreaming && status?.error && autoRestart && lastStartParams.current) {
      let secs = 10;
      setRestartCountdown(secs);
      restartCountdownRef.current = setInterval(() => {
        secs--;
        if (secs <= 0) {
          clearInterval(restartCountdownRef.current!);
          restartCountdownRef.current = null;
          setRestartCountdown(null);
        } else {
          setRestartCountdown(secs);
        }
      }, 1000);

      const params = lastStartParams.current;
      restartTimerRef.current = setTimeout(() => {
        startMutation.mutate({ data: params });
      }, 10000);
    }

    // Stream started again: cancel pending restart
    if (isStreaming) {
      if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
      if (restartCountdownRef.current) { clearInterval(restartCountdownRef.current); restartCountdownRef.current = null; }
      setRestartCountdown(null);
    }
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Schedule countdown ticker
  useEffect(() => {
    if (!scheduleActive || !scheduleTime) return;
    const target = getScheduleTargetDate(scheduleTime);
    if (!target) return;

    scheduleTimerRef.current = setInterval(() => {
      const remaining = target.getTime() - Date.now();
      if (remaining <= 0) {
        clearInterval(scheduleTimerRef.current!);
        scheduleTimerRef.current = null;
        setScheduleActive(false);
        setScheduleCountdown("");
        // Auto-start
        if (!isStreaming && streamKey.trim() && selectedVideo) {
          const params = { streamKey: streamKey.trim(), videoFile: selectedVideo, format };
          lastStartParams.current = params;
          startMutation.mutate({ data: params });
        }
      } else {
        setScheduleCountdown(formatCountdown(remaining));
      }
    }, 1000);

    return () => { if (scheduleTimerRef.current) clearInterval(scheduleTimerRef.current); };
  }, [scheduleActive]); // eslint-disable-line react-hooks/exhaustive-deps

  function getUploadUrl() {
    if (backendUrl) return `${backendUrl}/api/stream/upload`;
    return `${BASE}/api/stream/upload`;
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError("");
    setUploadProgress(0);
    const form = new FormData();
    form.append("video", file);

    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", getUploadUrl());
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            qc.invalidateQueries({ queryKey: getListVideosQueryKey() });
            setSelectedVideo(data.filename);
            resolve();
          } catch {
            setUploadError("Upload falhou: resposta inválida do servidor");
            reject();
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            setUploadError(err.error || "Upload falhou");
          } catch {
            setUploadError(`Upload falhou (${xhr.status})`);
          }
          reject();
        }
      };
      xhr.onerror = () => { setUploading(false); setUploadError("Erro de conexão"); reject(); };
      xhr.send(form);
    });
  }

  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<"ok" | "fail" | null>(null);

  function saveBackendUrl() {
    const normalized = normalizeBackendUrl(backendUrlDraft);
    applyBackendUrl(normalized);
    setBackendUrlDraft(normalized);
    setBackendUrlState(normalized);
    setConnectionTestResult(null);
    qc.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() });
    qc.invalidateQueries({ queryKey: getListVideosQueryKey() });
  }

  async function testConnection() {
    const url = normalizeBackendUrl(backendUrlDraft);
    if (!url) return;
    setTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const res = await fetch(`${url}/api/healthz`, { signal: AbortSignal.timeout(8000) });
      setConnectionTestResult(res.ok ? "ok" : "fail");
    } catch {
      setConnectionTestResult("fail");
    } finally {
      setTestingConnection(false);
    }
  }

  function handleStart() {
    if (!streamKey.trim() || !selectedVideo) return;
    const params = { streamKey: streamKey.trim(), videoFile: selectedVideo, format };
    lastStartParams.current = params;
    startMutation.mutate({ data: params });
  }

  function handleSchedule() {
    if (!scheduleTime) return;
    const target = getScheduleTargetDate(scheduleTime);
    if (!target) return;
    setScheduleActive(true);
    setScheduleCountdown(formatCountdown(target.getTime() - Date.now()));
  }

  function cancelSchedule() {
    if (scheduleTimerRef.current) clearInterval(scheduleTimerRef.current);
    setScheduleActive(false);
    setScheduleCountdown("");
  }

  function cancelAutoRestart() {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (restartCountdownRef.current) clearInterval(restartCountdownRef.current);
    setRestartCountdown(null);
  }

  const canStart = !!(streamKey.trim() && selectedVideo && !isStreaming && !startMutation.isPending && !uploading && !needsBackendSetup);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      <style>{`
        :root { --accent: ${accent}; --accent-rgb: ${hexToRgb(accent)}; }
        .btn-accent { background: var(--accent); }
        .btn-accent:hover { filter: brightness(1.15); }
        .badge-live { background: rgba(var(--accent-rgb), 0.15); color: var(--accent); border: 1px solid rgba(var(--accent-rgb), 0.3); }
        .live-dot { background: var(--accent); }
        .progress-bar { background: var(--accent); }
        .selected-video { border-color: var(--accent) !important; background: rgba(var(--accent-rgb), 0.1) !important; }
        .color-swatch.active { border-color: white !important; }
        .step-badge { background: var(--accent); color: #000; }
        .toggle-on { background: var(--accent); }
      `}</style>

      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/5">
        <div className="max-w-screen-lg mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: accent }}>
            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <span className="font-bold text-base tracking-tight">LiveStream Loop</span>

          {isStreaming && (
            <div className="ml-2 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold badge-live">
              <span className="w-1.5 h-1.5 rounded-full live-dot animate-pulse"/>
              LIVE · {elapsed}
            </div>
          )}

          {scheduleActive && !isStreaming && (
            <div className="ml-2 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"/>
              ⏰ {scheduleCountdown}
            </div>
          )}

          <div className="ml-auto">
            <button
              onClick={() => { setShowSettings(!showSettings); setBackendUrlDraft(backendUrl); }}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b border-white/5 bg-[#111] px-4 py-5">
          <div className="max-w-screen-lg mx-auto space-y-5">

            {/* Backend URL */}
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-2">
                Backend URL {IS_GITHUB_PAGES && <span className="text-yellow-500 ml-1">— Required on GitHub Pages</span>}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={backendUrlDraft}
                  onChange={(e) => { setBackendUrlDraft(e.target.value); setConnectionTestResult(null); }}
                  placeholder="youtubelivestreamer-production.up.railway.app"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/30"
                />
                <button
                  onClick={testConnection}
                  disabled={testingConnection || !backendUrlDraft.trim()}
                  className="px-3 py-2.5 rounded-xl text-sm font-semibold border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {testingConnection ? "…" : "Test"}
                </button>
                <button
                  onClick={saveBackendUrl}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-black btn-accent whitespace-nowrap"
                >
                  Save
                </button>
              </div>
              {connectionTestResult === "ok" && (
                <p className="text-xs text-green-400 mt-1.5">✅ Connected! Click Save to apply.</p>
              )}
              {connectionTestResult === "fail" && (
                <p className="text-xs text-red-400 mt-1.5">❌ Could not reach backend.</p>
              )}
            </div>

            {/* Accent Color */}
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Accent Color</p>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    title={c.name}
                    onClick={() => setAccent(c.value)}
                    className={`color-swatch w-8 h-8 rounded-full border-2 transition-all ${accent === c.value ? "active scale-110 border-white" : "border-transparent"}`}
                    style={{ background: c.value }}
                  />
                ))}
                <label title="Custom color" className="w-8 h-8 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:border-white/40 transition-colors overflow-hidden relative">
                  <span className="text-xs text-white/40">+</span>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                </label>
              </div>
            </div>

            {/* Auto-Restart Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-Restart</p>
                <p className="text-xs text-white/30 mt-0.5">Se a live cair, reinicia sozinha em 10 segundos</p>
              </div>
              <button
                onClick={() => setAutoRestart(!autoRestart)}
                className={`relative w-11 h-6 rounded-full transition-colors ${autoRestart ? "toggle-on" : "bg-white/10"}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${autoRestart ? "translate-x-5.5 left-0" : "left-0.5"}`} style={{ transform: autoRestart ? "translateX(22px)" : "translateX(0)" }} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Pages setup banner */}
      {needsBackendSetup && (
        <div className="bg-yellow-950/50 border-b border-yellow-800/40 px-4 py-3">
          <div className="max-w-screen-lg mx-auto flex items-center gap-3">
            <span className="text-yellow-400 text-lg">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-yellow-300 font-medium">Backend URL required</p>
              <p className="text-xs text-yellow-600">Open ⚙️ Settings and enter your Railway backend URL.</p>
            </div>
            <button onClick={() => setShowSettings(true)} className="shrink-0 px-3 py-1.5 rounded-lg bg-yellow-800/50 hover:bg-yellow-800/80 text-xs text-yellow-300 font-semibold transition-colors">
              Configure
            </button>
          </div>
        </div>
      )}

      <main className="max-w-screen-lg mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* LEFT COLUMN */}
        <div className="space-y-5">

          {/* Live status */}
          {isStreaming && (
            <div className="rounded-2xl p-5 border" style={{ background: `rgba(${hexToRgb(accent)}, 0.08)`, borderColor: `rgba(${hexToRgb(accent)}, 0.25)` }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full live-dot animate-pulse"/>
                  <span className="font-semibold text-sm" style={{ color: accent }}>Stream Ativa</span>
                </div>
                <span className="font-mono text-sm text-white/60">{elapsed}</span>
              </div>
              <p className="text-sm text-white/50 truncate">
                Arquivo: <span className="text-white/80">{status?.videoFile}</span>
              </p>
              {status?.startedAt && (
                <p className="text-xs text-white/30 mt-1">
                  Iniciada às {new Date(status.startedAt).toLocaleTimeString("pt-BR")}
                </p>
              )}
              {autoRestart && (
                <p className="text-xs mt-2 flex items-center gap-1" style={{ color: accent }}>
                  <span>🔄</span> Auto-restart ativado
                </p>
              )}
            </div>
          )}

          {/* Auto-restart countdown */}
          {restartCountdown !== null && (
            <div className="rounded-2xl p-4 bg-yellow-950/50 border border-yellow-800/40 flex items-center justify-between">
              <div>
                <p className="text-sm text-yellow-300 font-semibold">🔄 Reiniciando em {restartCountdown}s...</p>
                <p className="text-xs text-yellow-600 mt-0.5">Auto-restart ativado</p>
              </div>
              <button
                onClick={cancelAutoRestart}
                className="px-3 py-1.5 rounded-lg bg-yellow-800/50 hover:bg-yellow-800/80 text-xs text-yellow-300 font-semibold transition-colors"
              >
                Cancelar
              </button>
            </div>
          )}

          {/* Error */}
          {status?.error && !isStreaming && restartCountdown === null && (
            <div className="rounded-2xl p-4 bg-red-950/50 border border-red-800/40 space-y-2">
              <p className="text-sm text-red-300 font-semibold">❌ Stream parou — {status.error.length > 120 ? status.error.slice(0, 120) + "…" : status.error}</p>
              <div className="bg-black/40 rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
                {(status as unknown as { ffmpegLog?: string[] }).ffmpegLog?.slice(-8).map((line, i) => (
                  <p key={i} className="text-xs font-mono text-white/40 break-all">{line}</p>
                ))}
              </div>
              <p className="text-xs text-red-400/70">💡 Abra o YouTube Studio → Go Live e confirme que a live está em modo "Aguardando stream".</p>
            </div>
          )}

          {/* Step 1: Upload */}
          <div className="bg-[#111] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="step-badge w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <h2 className="font-semibold text-sm">Upload do Vídeo</h2>
            </div>

            <div
              className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center cursor-pointer hover:border-white/20 transition-all"
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
            >
              <input ref={fileInputRef} type="file" accept=".mp4,.mov,.avi,.mkv,.webm,.flv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
              {uploading ? (
                <div className="space-y-3">
                  <p className="text-sm text-white/50">Enviando... {uploadProgress}%</p>
                  <div className="w-full bg-white/10 rounded-full h-1.5">
                    <div className="progress-bar h-1.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              ) : (
                <>
                  <svg className="w-10 h-10 mx-auto mb-3 text-white/15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                  </svg>
                  <p className="text-sm text-white/40">Clique ou arraste o vídeo aqui</p>
                  <p className="text-xs text-white/20 mt-1">MP4, MOV, AVI, MKV, WEBM · Máx 2 GB</p>
                </>
              )}
            </div>

            {uploadError && <p className="text-sm text-red-400 mt-2">⚠️ {uploadError}</p>}

            {videos && videos.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-white/25 uppercase tracking-wider">Seus Vídeos</p>
                {videos.map((v) => (
                  <div
                    key={v.filename}
                    className={`w-full flex items-center gap-2 px-3 py-3 rounded-xl border text-sm transition-all ${selectedVideo === v.filename ? "selected-video" : "border-white/5 bg-white/[0.02] hover:border-white/10"}`}
                  >
                    <button
                      onClick={() => setSelectedVideo(v.filename)}
                      className="flex-1 flex items-center gap-2 min-w-0 text-left"
                    >
                      <svg className="w-4 h-4 shrink-0 text-white/25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                      </svg>
                      <span className={`truncate text-left text-sm ${selectedVideo === v.filename ? "text-white" : "text-white/50"}`}>{v.originalName}</span>
                      <span className="text-xs text-white/20 ml-auto shrink-0">{formatBytes(v.size)}</span>
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate({ filename: v.filename })}
                      disabled={deleteMutation.isPending || (isStreaming && status?.videoFile === v.filename)}
                      title="Deletar vídeo"
                      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-white/20 transition-colors disabled:opacity-30"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Stream Key + Format */}
          <div className="bg-[#111] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="step-badge w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <h2 className="font-semibold text-sm">Stream Key do YouTube</h2>
            </div>
            <p className="text-xs text-white/25 mb-3">YouTube Studio → Go Live → Chave de transmissão</p>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={streamKey}
                onChange={(e) => setStreamKey(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/15 focus:outline-none pr-12"
                style={{ borderColor: streamKey ? `rgba(${hexToRgb(accent)}, 0.4)` : undefined }}
              />
              <button onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors">
                {showKey
                  ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>
                  : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                }
              </button>
            </div>

            {/* Format selector */}
            <div className="mt-4">
              <p className="text-xs text-white/25 uppercase tracking-wider mb-2">Formato</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setFormat("landscape")}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-sm font-medium transition-all ${format === "landscape" ? "border-[--accent] bg-[rgba(var(--accent-rgb),0.12)] text-white" : "border-white/10 bg-white/[0.02] text-white/40 hover:border-white/20"}`}
                >
                  <svg viewBox="0 0 32 18" className="w-8 h-5" fill="none">
                    <rect x="1" y="1" width="30" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M12 9l5-3v6l-5-3z" fill="currentColor" opacity="0.6"/>
                  </svg>
                  <span className="text-xs">Landscape</span>
                  <span className="text-[10px] text-white/30">16:9 · YouTube</span>
                </button>
                <button
                  onClick={() => setFormat("shorts")}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-sm font-medium transition-all ${format === "shorts" ? "border-[--accent] bg-[rgba(var(--accent-rgb),0.12)] text-white" : "border-white/10 bg-white/[0.02] text-white/40 hover:border-white/20"}`}
                >
                  <svg viewBox="0 0 18 32" className="w-5 h-8" fill="none">
                    <rect x="1" y="1" width="16" height="30" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M9 13l4 3-4 3V13z" fill="currentColor" opacity="0.6"/>
                  </svg>
                  <span className="text-xs">Shorts</span>
                  <span className="text-[10px] text-white/30">9:16 · Vertical</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-5">

          {/* Step 3: Control */}
          <div className="bg-[#111] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="step-badge w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <h2 className="font-semibold text-sm">Controle</h2>
            </div>

            {isStreaming ? (
              <button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className="w-full py-4 rounded-xl font-semibold text-sm bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 transition-all disabled:opacity-50"
              >
                {stopMutation.isPending ? "Parando..." : "⏹ Parar Live"}
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={!canStart || scheduleActive}
                className="w-full py-4 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed btn-accent"
              >
                {startMutation.isPending ? "Iniciando..." : "🔴 Iniciar Loop Infinito"}
              </button>
            )}

            {startMutation.isError && (
              <p className="text-sm text-red-400 mt-3 text-center">
                {(startMutation.error as { data?: { error?: string } })?.data?.error ?? "Falha ao iniciar stream"}
              </p>
            )}

            {!isStreaming && !needsBackendSetup && !scheduleActive && (
              <div className="mt-3 space-y-1 text-center">
                {!selectedVideo && <p className="text-xs text-white/20">① Faça upload e selecione um vídeo</p>}
                {selectedVideo && !streamKey.trim() && <p className="text-xs text-white/20">② Digite sua stream key</p>}
                {selectedVideo && streamKey.trim() && <p className="text-xs text-white/35">Pronto para ir ao vivo ✓</p>}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="bg-[#111] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs shrink-0">⏰</span>
              <h2 className="font-semibold text-sm">Agendar Live</h2>
            </div>

            {scheduleActive ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-4 text-center">
                  <p className="text-xs text-yellow-500/70 mb-1">A live vai iniciar em</p>
                  <p className="text-3xl font-mono font-bold text-yellow-400">{scheduleCountdown}</p>
                  <p className="text-xs text-yellow-500/50 mt-1">às {scheduleTime}</p>
                </div>
                <button
                  onClick={cancelSchedule}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                >
                  Cancelar Agendamento
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-white/25">Defina um horário para iniciar a live automaticamente</p>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
                    style={{ colorScheme: "dark" }}
                  />
                  <button
                    onClick={handleSchedule}
                    disabled={!scheduleTime || !canStart}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold text-black btn-accent disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    Agendar
                  </button>
                </div>
                {!canStart && scheduleTime && (
                  <p className="text-xs text-white/20">
                    {!selectedVideo ? "Selecione um vídeo primeiro" : !streamKey.trim() ? "Digite a stream key primeiro" : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="bg-[#111] border border-white/5 rounded-2xl p-5">
            <h3 className="font-semibold text-sm mb-4">Como pegar sua Stream Key</h3>
            <ol className="space-y-3">
              {[
                ["Acesse", "studio.youtube.com"],
                ["Clique em", "Criar → Transmitir ao vivo"],
                ["Escolha", "Software de codificação"],
                ["Copie a", "Chave de transmissão"],
                ["Mantenha", "a aba do Studio aberta!"],
              ].map(([label, action], i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="step-badge w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <p className="text-sm text-white/40">{label} <span className="text-white/70">{action}</span></p>
                </li>
              ))}
            </ol>
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-2 gap-3">
            {[
              ["∞", "Loop Infinito", "Vídeo reinicia sozinho"],
              ["⚡", "FFmpeg", "Stream de alta qualidade"],
              ["🔄", "Auto-Restart", "Reconecta se cair"],
              ["🔒", "Key Segura", "Stream key oculta"],
            ].map(([icon, title, desc]) => (
              <div key={title as string} className="bg-[#111] border border-white/5 rounded-2xl p-4">
                <div className="text-2xl mb-1">{icon}</div>
                <p className="text-xs font-semibold text-white/80">{title}</p>
                <p className="text-xs text-white/25 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-white/15 mt-4">
        LiveStream Loop · Para criadores do YouTube
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StreamerApp />
    </QueryClientProvider>
  );
}
