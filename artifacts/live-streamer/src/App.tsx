import { useState, useRef, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useGetStreamStatus,
  useStartStream,
  useStopStream,
  usePauseStream,
  useResumeStream,
  useSetVolume,
  useDeleteVideo,
  useListVideos,
  getGetStreamStatusQueryKey,
  getListVideosQueryKey,
  setBaseUrl,
} from "@workspace/api-client-react";

const queryClient = new QueryClient();
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IS_GITHUB_PAGES = window.location.hostname.includes("github.io");

function getSavedBackendUrl() { return localStorage.getItem("backendUrl") || ""; }
function normalizeBackendUrl(raw: string) {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
function applyBackendUrl(url: string) {
  const n = normalizeBackendUrl(url);
  if (n) { localStorage.setItem("backendUrl", n); setBaseUrl(n); }
  else { localStorage.removeItem("backendUrl"); setBaseUrl(null); }
}
const initUrl = getSavedBackendUrl();
if (initUrl) setBaseUrl(initUrl);

const ACCENT_COLORS = [
  { name: "YouTube Red", value: "#FF0000" },
  { name: "Electric Blue", value: "#2563EB" },
  { name: "Violet", value: "#7C3AED" },
  { name: "Emerald", value: "#059669" },
  { name: "Orange", value: "#EA580C" },
  { name: "Pink", value: "#DB2777" },
  { name: "Cyan", value: "#0891B2" },
  { name: "Gold", value: "#D97706" },
];

function hexToRgb(hex: string) {
  return `${parseInt(hex.slice(1,3),16)} ${parseInt(hex.slice(3,5),16)} ${parseInt(hex.slice(5,7),16)}`;
}
function formatBytes(b: number) {
  if (b < 1048576) return (b/1024).toFixed(1)+" KB";
  if (b < 1073741824) return (b/1048576).toFixed(1)+" MB";
  return (b/1073741824).toFixed(2)+" GB";
}
function formatDur(startedAt: string | null) {
  if (!startedAt) return "00:00:00";
  const d = Math.floor((Date.now()-new Date(startedAt).getTime())/1000);
  return `${Math.floor(d/3600).toString().padStart(2,"0")}:${Math.floor((d%3600)/60).toString().padStart(2,"0")}:${(d%60).toString().padStart(2,"0")}`;
}
function getScheduleTarget(t: string): Date|null {
  const [hh,mm]=t.split(":").map(Number);
  if(isNaN(hh)||isNaN(mm)) return null;
  const d=new Date(); d.setHours(hh,mm,0,0);
  if(d.getTime()<=Date.now()) d.setDate(d.getDate()+1);
  return d;
}
function fmtCountdown(ms: number) {
  const s=Math.max(0,Math.floor(ms/1000));
  return `${Math.floor(s/3600).toString().padStart(2,"0")}:${Math.floor((s%3600)/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
}

function VolumeIcon({ level }: { level: number }) {
  if (level === 0) return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>
    </svg>
  );
  if (level < 50) return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
    </svg>
  );
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
    </svg>
  );
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
  const [format, setFormat] = useState<"landscape"|"shorts">("landscape");
  const [volume, setVolume] = useState(100);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [elapsed, setElapsed] = useState("00:00:00");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleCountdown, setScheduleCountdown] = useState("");
  const [scheduleActive, setScheduleActive] = useState(false);
  const [autoRestart, setAutoRestart] = useState(() => localStorage.getItem("autoRestart")==="true");
  const [restartCountdown, setRestartCountdown] = useState<number|null>(null);
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<"ok"|"fail"|null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const schedTimerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const restartCdRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const prevStreaming = useRef<boolean|null>(null);
  const lastParams = useRef<{streamKey:string;videoFile:string;format:"landscape"|"shorts";volume:number}|null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-rgb", hexToRgb(accent));
    localStorage.setItem("accent", accent);
  }, [accent]);

  useEffect(() => { localStorage.setItem("autoRestart", String(autoRestart)); }, [autoRestart]);

  const needsBackend = IS_GITHUB_PAGES && !backendUrl;

  const { data: status } = useGetStreamStatus({
    query: { queryKey: getGetStreamStatusQueryKey(), refetchInterval: 2000, enabled: !needsBackend },
  });
  const { data: videos } = useListVideos({
    query: { queryKey: getListVideosQueryKey(), enabled: !needsBackend },
  });

  const inv = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() });
  }, [qc]);

  const startM = useStartStream({ mutation: { onSuccess: inv } });
  const stopM = useStopStream({ mutation: { onSuccess: inv } });
  const pauseM = usePauseStream({ mutation: { onSuccess: inv } });
  const resumeM = useResumeStream({ mutation: { onSuccess: inv } });
  const volumeM = useSetVolume({ mutation: { onSuccess: inv } });
  const deleteM = useDeleteVideo({
    mutation: {
      onSuccess: (_d, { filename }) => {
        qc.invalidateQueries({ queryKey: getListVideosQueryKey() });
        if (selectedVideo === filename) setSelectedVideo("");
      },
    },
  });

  const isStreaming = status?.isStreaming ?? false;
  const isPaused = status?.isPaused ?? false;
  const serverVolume = status?.volume ?? 100;

  const startTimer = useCallback((at: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(formatDur(at)), 1000);
  }, []);

  useEffect(() => {
    if (isStreaming && status?.startedAt) startTimer(status.startedAt);
    else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsed("00:00:00");
    }
  }, [isStreaming, status?.startedAt, startTimer]);

  // Auto-restart
  useEffect(() => {
    if (prevStreaming.current === null) { prevStreaming.current = isStreaming; return; }
    const was = prevStreaming.current;
    prevStreaming.current = isStreaming;
    if (was && !isStreaming && status?.error && autoRestart && lastParams.current) {
      let s = 10; setRestartCountdown(s);
      restartCdRef.current = setInterval(() => {
        s--; if (s<=0) { clearInterval(restartCdRef.current!); setRestartCountdown(null); } else setRestartCountdown(s);
      }, 1000);
      restartTimerRef.current = setTimeout(() => { if(lastParams.current) startM.mutate({data:lastParams.current}); }, 10000);
    }
    if (isStreaming) {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (restartCdRef.current) clearInterval(restartCdRef.current);
      setRestartCountdown(null);
    }
  }, [isStreaming]); // eslint-disable-line

  // Schedule
  useEffect(() => {
    if (!scheduleActive || !scheduleTime) return;
    const target = getScheduleTarget(scheduleTime);
    if (!target) return;
    schedTimerRef.current = setInterval(() => {
      const rem = target.getTime() - Date.now();
      if (rem <= 0) {
        clearInterval(schedTimerRef.current!); setScheduleActive(false); setScheduleCountdown("");
        if (!isStreaming && streamKey.trim() && selectedVideo) {
          const p = { streamKey: streamKey.trim(), videoFile: selectedVideo, format, volume };
          lastParams.current = p; startM.mutate({ data: p });
        }
      } else setScheduleCountdown(fmtCountdown(rem));
    }, 1000);
    return () => { if (schedTimerRef.current) clearInterval(schedTimerRef.current); };
  }, [scheduleActive]); // eslint-disable-line

  function getUploadUrl() {
    return backendUrl ? `${backendUrl}/api/stream/upload` : `${BASE}/api/stream/upload`;
  }

  async function handleUpload(file: File) {
    setUploading(true); setUploadError(""); setUploadProgress(0);
    const form = new FormData(); form.append("video", file);
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", getUploadUrl());
      xhr.upload.onprogress = (e) => { if(e.lengthComputable) setUploadProgress(Math.round(e.loaded/e.total*100)); };
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status===200) {
          try { const d=JSON.parse(xhr.responseText); qc.invalidateQueries({queryKey:getListVideosQueryKey()}); setSelectedVideo(d.filename); resolve(); }
          catch { setUploadError("Resposta inválida do servidor"); reject(); }
        } else {
          try { setUploadError(JSON.parse(xhr.responseText).error||"Upload falhou"); } catch { setUploadError(`Upload falhou (${xhr.status})`); }
          reject();
        }
      };
      xhr.onerror = () => { setUploading(false); setUploadError("Erro de conexão"); reject(); };
      xhr.send(form);
    });
  }

  async function testConnection() {
    const url = normalizeBackendUrl(backendUrlDraft);
    if (!url) return;
    setTestingConn(true); setConnResult(null);
    try { const r = await fetch(`${url}/api/healthz`, {signal:AbortSignal.timeout(8000)}); setConnResult(r.ok?"ok":"fail"); }
    catch { setConnResult("fail"); }
    finally { setTestingConn(false); }
  }

  function saveBackendUrl() {
    const n = normalizeBackendUrl(backendUrlDraft);
    applyBackendUrl(n); setBackendUrlDraft(n); setBackendUrlState(n); setConnResult(null);
    qc.invalidateQueries({queryKey:getGetStreamStatusQueryKey()});
    qc.invalidateQueries({queryKey:getListVideosQueryKey()});
  }

  function handleStart() {
    if (!streamKey.trim()||!selectedVideo) return;
    const p = { streamKey:streamKey.trim(), videoFile:selectedVideo, format, volume };
    lastParams.current = p; startM.mutate({data:p});
  }

  function handleVolumeChange(v: number) {
    setVolume(v);
    if (isStreaming) volumeM.mutate({data:{volume:v}});
  }

  function handleSchedule() {
    const t = getScheduleTarget(scheduleTime); if(!t) return;
    setScheduleActive(true); setScheduleCountdown(fmtCountdown(t.getTime()-Date.now()));
  }

  const canStart = !!(streamKey.trim()&&selectedVideo&&!isStreaming&&!startM.isPending&&!uploading&&!needsBackend);

  const accentRgb = hexToRgb(accent);

  return (
    <div className="min-h-screen text-white font-sans" style={{background:"#080808"}}>
      <style>{`
        :root{--accent:${accent};--accent-rgb:${accentRgb};}
        .accent-bg{background:var(--accent);}
        .accent-bg:hover{filter:brightness(1.12);}
        .accent-border{border-color:var(--accent)!important;}
        .accent-text{color:var(--accent);}
        .accent-glow{box-shadow:0 0 20px rgba(var(--accent-rgb),0.3);}
        .live-badge{background:rgba(var(--accent-rgb),0.12);color:var(--accent);border:1px solid rgba(var(--accent-rgb),0.25);}
        .live-dot{background:var(--accent);}
        .progress-fill{background:var(--accent);}
        .vol-fill{background:var(--accent);}
        .card{background:#111;border:1px solid rgba(255,255,255,0.05);border-radius:20px;}
        .card-inner{background:#0d0d0d;border:1px solid rgba(255,255,255,0.04);border-radius:14px;}
        .step-num{background:var(--accent);color:#000;font-weight:700;}
        .swatch-active{outline:2px solid white;outline-offset:2px;}
        .video-selected{border-color:rgba(var(--accent-rgb),0.5)!important;background:rgba(var(--accent-rgb),0.07)!important;}
        .btn-ghost{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);}
        .btn-ghost:hover{background:rgba(255,255,255,0.08);}
        .toggle-track{transition:background .2s;}
        .toggle-track.on{background:var(--accent);}
        .toggle-track.off{background:rgba(255,255,255,0.12);}
        input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;}
        input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:99px;background:rgba(255,255,255,0.1);}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--accent);margin-top:-6px;box-shadow:0 0 8px rgba(var(--accent-rgb),0.5);}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeIn .3s ease}
        @keyframes pulse-ring{0%{transform:scale(1);opacity:0.8}100%{transform:scale(1.5);opacity:0}}
        .live-ring{animation:pulse-ring 1.5s ease-out infinite;}
      `}</style>

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.04]" style={{background:"rgba(8,8,8,0.92)",backdropFilter:"blur(16px)"}}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          {/* Logo */}
          <div className="w-8 h-8 rounded-xl accent-bg flex items-center justify-center shrink-0 accent-glow">
            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <span className="font-bold tracking-tight">LiveStream Loop</span>

          {/* Live badge */}
          {isStreaming && (
            <div className="relative ml-1 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold live-badge fade-in">
              <span className="relative flex h-2 w-2">
                <span className="live-ring absolute inline-flex h-full w-full rounded-full live-dot opacity-75"/>
                <span className="relative inline-flex rounded-full h-2 w-2 live-dot"/>
              </span>
              {isPaused ? "⏸ PAUSADO" : `LIVE · ${elapsed}`}
            </div>
          )}

          {scheduleActive && !isStreaming && (
            <div className="ml-1 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/12 text-amber-400 border border-amber-500/25">
              ⏰ {scheduleCountdown}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => { setShowSettings(!showSettings); setBackendUrlDraft(backendUrl); }}
              className="w-9 h-9 rounded-xl btn-ghost flex items-center justify-center transition-colors">
              <svg className="w-4 h-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* ── SETTINGS ── */}
      {showSettings && (
        <div className="border-b border-white/[0.04] px-4 py-5 fade-in" style={{background:"#0d0d0d"}}>
          <div className="max-w-5xl mx-auto space-y-5">
            <div>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-2">
                Backend URL {IS_GITHUB_PAGES && <span className="text-amber-400 ml-1 normal-case">— obrigatório no GitHub Pages</span>}
              </p>
              <div className="flex gap-2">
                <input type="text" value={backendUrlDraft}
                  onChange={(e) => { setBackendUrlDraft(e.target.value); setConnResult(null); }}
                  placeholder="youtubelivestreamer-production.up.railway.app"
                  className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20"
                />
                <button onClick={testConnection} disabled={testingConn||!backendUrlDraft.trim()}
                  className="px-3 py-2.5 rounded-xl text-sm font-semibold btn-ghost disabled:opacity-40 transition-colors whitespace-nowrap">
                  {testingConn?"…":"Testar"}
                </button>
                <button onClick={saveBackendUrl}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold text-black accent-bg whitespace-nowrap">
                  Salvar
                </button>
              </div>
              {connResult==="ok"&&<p className="text-xs text-emerald-400 mt-1.5">✅ Conectado! Clique em Salvar.</p>}
              {connResult==="fail"&&<p className="text-xs text-red-400 mt-1.5">❌ Não foi possível conectar.</p>}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-2">Cor de destaque</p>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map(c=>(
                  <button key={c.value} title={c.name} onClick={()=>setAccent(c.value)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${accent===c.value?"swatch-active scale-110":"border-transparent"}`}
                    style={{background:c.value}}/>
                ))}
                <label className="w-8 h-8 rounded-full border-2 border-dashed border-white/15 flex items-center justify-center cursor-pointer hover:border-white/30 overflow-hidden relative">
                  <span className="text-xs text-white/30">+</span>
                  <input type="color" value={accent} onChange={e=>setAccent(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"/>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Auto-Restart</p>
                <p className="text-xs text-white/30 mt-0.5">Se a live cair, reinicia automaticamente em 10s</p>
              </div>
              <button onClick={()=>setAutoRestart(!autoRestart)}
                className={`relative w-11 h-6 rounded-full toggle-track ${autoRestart?"on":"off"}`}>
                <span className="absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform"
                  style={{left:"2px",transform:autoRestart?"translateX(20px)":"translateX(0)"}}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BACKEND BANNER ── */}
      {needsBackend && (
        <div className="border-b border-amber-900/30 px-4 py-3" style={{background:"rgba(120,80,0,0.12)"}}>
          <div className="max-w-5xl mx-auto flex items-center gap-3">
            <span className="text-amber-400 text-lg shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-300 font-semibold">URL do backend necessária</p>
              <p className="text-xs text-amber-700">Abra ⚙️ Configurações e insira a URL do Railway.</p>
            </div>
            <button onClick={()=>setShowSettings(true)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs text-amber-300 font-semibold"
              style={{background:"rgba(120,80,0,0.3)"}}>
              Configurar
            </button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ══ LEFT ══ */}
        <div className="space-y-4">

          {/* Live Status Card */}
          {isStreaming && (
            <div className="card p-5 fade-in" style={{borderColor:`rgba(${accentRgb},0.2)`,background:`rgba(${accentRgb},0.05)`}}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="relative w-3 h-3 flex items-center justify-center">
                    <span className="absolute w-full h-full rounded-full live-dot live-ring opacity-50"/>
                    <span className="w-2.5 h-2.5 rounded-full live-dot"/>
                  </div>
                  <div>
                    <p className="font-bold text-sm accent-text">{isPaused?"Stream Pausada":"Stream Ativa"}</p>
                    {status?.startedAt && (
                      <p className="text-[11px] text-white/30 mt-0.5">
                        Iniciada às {new Date(status.startedAt).toLocaleTimeString("pt-BR")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-bold text-white/80">{elapsed}</p>
                  <p className="text-[11px] text-white/25 mt-0.5">{status?.format?.toUpperCase()} · {serverVolume}%🔊</p>
                </div>
              </div>

              {status?.videoFile && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl" style={{background:"rgba(0,0,0,0.3)"}}>
                  <svg className="w-3.5 h-3.5 text-white/25 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  <span className="text-xs text-white/50 truncate">{status.videoFile}</span>
                </div>
              )}

              {/* Live controls */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {!isPaused ? (
                  <button onClick={()=>pauseM.mutate()} disabled={pauseM.isPending}
                    className="py-2.5 rounded-xl text-sm font-semibold btn-ghost transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
                    {pauseM.isPending?"Pausando...":"Pausar"}
                  </button>
                ) : (
                  <button onClick={()=>resumeM.mutate()} disabled={resumeM.isPending}
                    className="py-2.5 rounded-xl text-sm font-bold text-black accent-bg transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    {resumeM.isPending?"Retomando...":"Retomar"}
                  </button>
                )}
                <button onClick={()=>stopM.mutate()} disabled={stopM.isPending}
                  className="py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.25)",color:"#f87171"}}>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                  {stopM.isPending?"Parando...":"Parar Live"}
                </button>
              </div>

              {/* Volume slider — live */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-white/40">
                    <VolumeIcon level={serverVolume}/>
                    <span className="text-xs">Volume</span>
                  </div>
                  <span className="text-xs font-mono text-white/50">{serverVolume}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={()=>handleVolumeChange(0)} className="text-xs text-white/30 hover:text-white/60 transition-colors">🔇</button>
                  <input type="range" min="0" max="100" value={serverVolume}
                    onChange={e=>handleVolumeChange(Number(e.target.value))}
                    className="flex-1 h-1"/>
                  <button onClick={()=>handleVolumeChange(100)} className="text-xs text-white/30 hover:text-white/60 transition-colors">🔊</button>
                </div>
                <div className="flex gap-1.5 mt-2">
                  {[0,25,50,75,100].map(v=>(
                    <button key={v} onClick={()=>handleVolumeChange(v)}
                      className={`flex-1 py-1 rounded-lg text-[10px] font-semibold transition-all ${serverVolume===v?"text-black accent-bg":"btn-ghost text-white/30 hover:text-white/60"}`}>
                      {v===0?"🔇":`${v}%`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Auto-restart countdown */}
          {restartCountdown!==null && (
            <div className="card p-4 fade-in" style={{borderColor:"rgba(251,191,36,0.2)",background:"rgba(120,80,0,0.1)"}}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-300 font-semibold">🔄 Reiniciando em {restartCountdown}s</p>
                  <p className="text-xs text-amber-700 mt-0.5">Auto-restart ativado</p>
                </div>
                <button onClick={()=>{if(restartTimerRef.current)clearTimeout(restartTimerRef.current);if(restartCdRef.current)clearInterval(restartCdRef.current);setRestartCountdown(null);}}
                  className="px-3 py-1.5 rounded-lg text-xs text-amber-300 font-semibold btn-ghost">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {status?.error&&!isStreaming&&restartCountdown===null && (
            <div className="card p-4 fade-in space-y-2" style={{borderColor:"rgba(239,68,68,0.2)",background:"rgba(239,68,68,0.05)"}}>
              <p className="text-sm text-red-300 font-semibold">❌ {status.error.length>100?status.error.slice(0,100)+"…":status.error}</p>
              <div className="rounded-xl p-3 space-y-1 max-h-28 overflow-y-auto" style={{background:"rgba(0,0,0,0.4)"}}>
                {(status as unknown as {ffmpegLog?:string[]}).ffmpegLog?.slice(-6).map((l,i)=>(
                  <p key={i} className="text-[11px] font-mono text-white/35 break-all">{l}</p>
                ))}
              </div>
              <p className="text-xs text-red-400/60">💡 Abra o YouTube Studio → Go Live e confirme que a live está "Aguardando stream".</p>
            </div>
          )}

          {/* ── Step 1: Video ── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="step-num w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">1</span>
              <h2 className="font-bold text-sm">Vídeo</h2>
            </div>

            <div className="card-inner border-dashed p-5 text-center cursor-pointer hover:border-white/15 transition-all"
              onClick={()=>!uploading&&fileInputRef.current?.click()}
              onDragOver={e=>e.preventDefault()}
              onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleUpload(f);}}>
              <input ref={fileInputRef} type="file" accept=".mp4,.mov,.avi,.mkv,.webm,.flv" className="hidden"
                onChange={e=>{const f=e.target.files?.[0];if(f)handleUpload(f);e.target.value="";}}/>
              {uploading?(
                <div className="space-y-3">
                  <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center" style={{background:"rgba(var(--accent-rgb),0.1)"}}>
                    <svg className="w-5 h-5 accent-text animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                    </svg>
                  </div>
                  <p className="text-sm text-white/50">Enviando {uploadProgress}%</p>
                  <div className="w-full bg-white/[0.06] rounded-full h-1">
                    <div className="progress-fill h-1 rounded-full transition-all" style={{width:`${uploadProgress}%`}}/>
                  </div>
                </div>
              ):(
                <>
                  <div className="w-10 h-10 mx-auto rounded-full mb-3 flex items-center justify-center" style={{background:"rgba(255,255,255,0.04)"}}>
                    <svg className="w-5 h-5 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                    </svg>
                  </div>
                  <p className="text-sm text-white/30">Clique ou arraste o vídeo</p>
                  <p className="text-xs text-white/15 mt-1">MP4, MOV, AVI, MKV · Máx 2 GB</p>
                </>
              )}
            </div>

            {uploadError&&<p className="text-xs text-red-400 mt-2 pl-1">⚠️ {uploadError}</p>}

            {videos&&videos.length>0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-white/20 uppercase tracking-widest pl-1">Seus vídeos</p>
                {videos.map(v=>(
                  <div key={v.filename}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${selectedVideo===v.filename?"video-selected border-transparent":"border-white/[0.05] hover:border-white/10"}`}>
                    <button onClick={()=>setSelectedVideo(v.filename)} className="flex-1 flex items-center gap-2 min-w-0 text-left">
                      <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${selectedVideo===v.filename?"accent-bg":"bg-white/[0.04]"}`}>
                        <svg className={`w-3.5 h-3.5 ${selectedVideo===v.filename?"fill-black":"fill-white/20"}`} viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                      <div className="min-w-0">
                        <p className={`text-xs font-medium truncate ${selectedVideo===v.filename?"text-white":"text-white/50"}`}>{v.originalName}</p>
                        <p className="text-[10px] text-white/20">{formatBytes(v.size)}</p>
                      </div>
                    </button>
                    <button onClick={()=>deleteM.mutate({filename:v.filename})}
                      disabled={deleteM.isPending||(isStreaming&&status?.videoFile===v.filename)}
                      className="shrink-0 w-7 h-7 rounded-lg btn-ghost flex items-center justify-center text-white/15 hover:text-red-400 transition-colors disabled:opacity-30">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Step 2: Key + Format ── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="step-num w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">2</span>
              <h2 className="font-bold text-sm">Stream Key</h2>
            </div>
            <p className="text-[11px] text-white/25 mb-2">YouTube Studio → Go Live → Chave de transmissão</p>
            <div className="relative">
              <input type={showKey?"text":"password"} value={streamKey}
                onChange={e=>setStreamKey(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-white/15 focus:outline-none pr-12 transition-colors"
                style={streamKey?{borderColor:`rgba(${accentRgb},0.35)`}:{}}/>
              <button onClick={()=>setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors">
                {showKey
                  ?<svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>
                  :<svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                }
              </button>
            </div>

            {/* Format */}
            <div className="mt-4">
              <p className="text-[10px] font-semibold text-white/20 uppercase tracking-widest mb-2">Formato</p>
              <div className="grid grid-cols-2 gap-2">
                {(["landscape","shorts"] as const).map(f=>(
                  <button key={f} onClick={()=>setFormat(f)}
                    className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-sm font-semibold transition-all ${format===f?"text-white accent-border":""}`}
                    style={format===f?{borderColor:`rgba(${accentRgb},0.5)`,background:`rgba(${accentRgb},0.1)`}:{border:"1px solid rgba(255,255,255,0.06)",background:"rgba(255,255,255,0.02)",color:"rgba(255,255,255,0.3)"}}>
                    {f==="landscape"
                      ?<svg viewBox="0 0 32 18" className="w-8 h-5" fill="none"><rect x="1" y="1" width="30" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M12 9l5-3v6l-5-3z" fill="currentColor" opacity="0.6"/></svg>
                      :<svg viewBox="0 0 18 32" className="w-5 h-8" fill="none"><rect x="1" y="1" width="16" height="30" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M9 13l4 3-4 3V13z" fill="currentColor" opacity="0.6"/></svg>
                    }
                    <span className="text-xs">{f==="landscape"?"Landscape":"Shorts"}</span>
                    <span className="text-[10px] opacity-40">{f==="landscape"?"16:9 · YouTube":"9:16 · Vertical"}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Volume (pre-start) */}
            {!isStreaming && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-white/30">
                    <VolumeIcon level={volume}/>
                    <span className="text-[11px]">Volume inicial</span>
                  </div>
                  <span className="text-[11px] font-mono text-white/40">{volume===0?"🔇 Mudo":`${volume}%`}</span>
                </div>
                <input type="range" min="0" max="100" value={volume}
                  onChange={e=>setVolume(Number(e.target.value))} className="w-full"/>
                <div className="flex gap-1.5 mt-2">
                  {[0,25,50,75,100].map(v=>(
                    <button key={v} onClick={()=>setVolume(v)}
                      className={`flex-1 py-1 rounded-lg text-[10px] font-semibold transition-all ${volume===v?"text-black accent-bg":"btn-ghost text-white/25 hover:text-white/50"}`}>
                      {v===0?"🔇":`${v}%`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ══ RIGHT ══ */}
        <div className="space-y-4">

          {/* ── Step 3: Control ── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="step-num w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">3</span>
              <h2 className="font-bold text-sm">Controle</h2>
            </div>

            {!isStreaming?(
              <>
                <button onClick={handleStart} disabled={!canStart||scheduleActive}
                  className="w-full py-4 rounded-xl font-bold text-sm text-black accent-bg transition-all disabled:opacity-30 disabled:cursor-not-allowed accent-glow">
                  {startM.isPending?"Iniciando…":"🔴 Iniciar Loop Infinito"}
                </button>
                {!canStart&&!scheduleActive&&(
                  <div className="mt-3 text-center space-y-1">
                    {!selectedVideo&&<p className="text-xs text-white/20">① Faça upload e selecione um vídeo</p>}
                    {selectedVideo&&!streamKey.trim()&&<p className="text-xs text-white/20">② Digite sua stream key</p>}
                    {canStart&&<p className="text-xs text-white/35">Pronto para ir ao vivo ✓</p>}
                  </div>
                )}
              </>
            ):(
              <div className="p-3 rounded-xl text-center" style={{background:"rgba(var(--accent-rgb),0.06)",border:"1px solid rgba(var(--accent-rgb),0.15)"}}>
                <p className="text-xs accent-text font-semibold">{isPaused?"⏸ Pausado — tela preta no YouTube":"🔴 Transmitindo ao vivo"}</p>
                <p className="text-[11px] text-white/25 mt-0.5">Use os controles no card de status</p>
              </div>
            )}

            {startM.isError&&(
              <p className="text-xs text-red-400 mt-3 text-center">
                {(startM.error as {data?:{error?:string}})?.data?.error??"Falha ao iniciar stream"}
              </p>
            )}
          </div>

          {/* ── Agendar ── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0" style={{background:"rgba(255,255,255,0.06)"}}>⏰</span>
              <h2 className="font-bold text-sm">Agendar Live</h2>
            </div>
            {scheduleActive?(
              <div className="space-y-3">
                <div className="rounded-xl p-4 text-center" style={{background:"rgba(251,191,36,0.07)",border:"1px solid rgba(251,191,36,0.15)"}}>
                  <p className="text-[11px] text-amber-500/60 mb-1">A live inicia em</p>
                  <p className="text-3xl font-mono font-bold text-amber-400">{scheduleCountdown}</p>
                  <p className="text-xs text-amber-600/50 mt-1">às {scheduleTime}</p>
                </div>
                <button onClick={()=>{if(schedTimerRef.current)clearInterval(schedTimerRef.current);setScheduleActive(false);setScheduleCountdown("");}}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold btn-ghost">
                  Cancelar Agendamento
                </button>
              </div>
            ):(
              <div className="space-y-3">
                <p className="text-xs text-white/25">Define um horário para iniciar automaticamente</p>
                <div className="flex gap-2">
                  <input type="time" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)}
                    className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                    style={{colorScheme:"dark"}}/>
                  <button onClick={handleSchedule} disabled={!scheduleTime||!canStart}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-black accent-bg disabled:opacity-30 whitespace-nowrap">
                    Agendar
                  </button>
                </div>
                {!canStart&&scheduleTime&&(
                  <p className="text-[11px] text-white/20">
                    {!selectedVideo?"Selecione um vídeo primeiro":!streamKey.trim()?"Digite a stream key primeiro":""}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── How to ── */}
          <div className="card p-5">
            <h3 className="font-bold text-sm mb-4">Como pegar a Stream Key</h3>
            <ol className="space-y-3">
              {[
                ["Acesse","studio.youtube.com"],
                ["Clique em","Criar → Transmitir ao vivo"],
                ["Escolha","Software de codificação"],
                ["Copie a","Chave de transmissão"],
                ["⚠️ Mantenha","a aba do Studio aberta!"],
              ].map(([l,a],i)=>(
                <li key={i} className="flex items-start gap-3">
                  <span className="step-num w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                  <p className="text-xs text-white/35">{l} <span className="text-white/65">{a}</span></p>
                </li>
              ))}
            </ol>
          </div>

          {/* ── Feature grid ── */}
          <div className="grid grid-cols-2 gap-3">
            {[
              ["∞","Loop Infinito","Nunca para sozinho"],
              ["⏸","Pausar Live","Tela preta sem parar"],
              ["🔊","Controle de Volume","0% a 100% em tempo real"],
              ["🔄","Auto-Restart","Reconecta se cair"],
            ].map(([icon,title,desc])=>(
              <div key={title as string} className="card p-4">
                <div className="text-xl mb-2">{icon}</div>
                <p className="text-xs font-bold text-white/70">{title}</p>
                <p className="text-[10px] text-white/25 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-white/[0.04] py-6 text-center" style={{borderColor:"rgba(255,255,255,0.04)"}}>
        <p className="text-xs text-white/15">LiveStream Loop · Para criadores do YouTube 🎥</p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StreamerApp/>
    </QueryClientProvider>
  );
}
