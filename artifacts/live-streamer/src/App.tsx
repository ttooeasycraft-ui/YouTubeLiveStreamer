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
  useSwitchVideo,
  useUpdatePlaylist,
  useImportChannelList,
  useImportDownload,
  useImportProgress,
  useListSessions,
  useCreateSession,
  useDeleteSession,
  useRenameSession,
  useStartSession,
  useStopSession,
  usePauseSession,
  useResumeSession,
  useSetSessionVolume,
  useSwitchSessionVideo,
  getGetStreamStatusQueryKey,
  getListVideosQueryKey,
  getListSessionsQueryKey,
  setBaseUrl,
  type SessionState,
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
  return `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`;
}
function formatBytes(b: number) {
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}
function formatDur(startedAt: string | null) {
  if (!startedAt) return "00:00:00";
  const d = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return `${Math.floor(d / 3600).toString().padStart(2, "0")}:${Math.floor((d % 3600) / 60).toString().padStart(2, "0")}:${(d % 60).toString().padStart(2, "0")}`;
}
function formatSeconds(s: number | null) {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
function getScheduleTarget(t: string): Date | null {
  const [hh, mm] = t.split(":").map(Number);
  if (isNaN(hh!) || isNaN(mm!)) return null;
  const d = new Date(); d.setHours(hh!, mm!, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}
function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

type Tab = "stream" | "playlist" | "import" | "sessions" | "packs";
type StreamPlatform = "youtube" | "tiktok" | "twitch" | "instagram";

const PLATFORM_LABELS: Record<StreamPlatform, string> = {
  youtube: "▶ YouTube",
  tiktok: "♪ TikTok",
  twitch: "🎮 Twitch",
  instagram: "📷 Instagram",
};

function VolumeIcon({ level }: { level: number }) {
  if (level === 0) return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
  );
  if (level < 50) return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
    </svg>
  );
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
    </svg>
  );
}

// ── Import Results with Shorts filter ─────────────────────────────────────────

type ImportVideo = { id: string; title: string; duration: number | null; thumbnail: string; url: string; isShort?: boolean };

function ImportResults({ data, downloadJobs, onDownload, isPending, onDone }: {
  data: { videos: ImportVideo[]; channelName: string | null };
  downloadJobs: { jobId: string; title: string }[];
  onDownload: (v: ImportVideo) => void;
  isPending: boolean;
  onDone: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "video" | "short">("all");
  const hasShorts = data.videos.some((v) => v.isShort);
  const hasVideos = data.videos.some((v) => !v.isShort);

  const visible = data.videos.filter((v) => {
    if (filter === "short") return v.isShort;
    if (filter === "video") return !v.isShort;
    return true;
  });

  return (
    <div className="space-y-3">
      {data.channelName && (
        <p className="text-xs text-white/30 px-1">📺 {data.channelName} · {data.videos.length} item{data.videos.length !== 1 ? "s" : ""}</p>
      )}

      {/* Filter tabs — only show when there's a mix */}
      {hasShorts && hasVideos && (
        <div className="flex gap-2">
          {([["all", "🎬 Todos"], ["video", "📺 Vídeos"], ["short", "📱 Shorts"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${filter === v ? "accent-bg text-black" : "btn-ghost text-white/40"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {visible.length > 0 ? (
        <div className="card p-5">
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {visible.map((v) => {
              const job = downloadJobs.find((j) => j.title === v.title);
              return (
                <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.05]">
                  {/* Thumbnail — portrait for Shorts, landscape for videos */}
                  {v.thumbnail && (
                    v.isShort
                      ? <img src={v.thumbnail} alt="" className="w-10 h-16 rounded-lg object-cover shrink-0 bg-white/5" loading="lazy" />
                      : <img src={v.thumbnail} alt="" className="w-20 h-11 rounded-lg object-cover shrink-0 bg-white/5" loading="lazy" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {v.isShort && <span className="text-[9px] font-bold bg-white/10 text-white/50 rounded px-1 py-0.5 shrink-0">📱 SHORT</span>}
                      <p className="text-xs font-medium text-white/70 line-clamp-2 leading-snug">{v.title}</p>
                    </div>
                    {v.duration != null && <p className="text-[10px] text-white/25">{formatSeconds(v.duration)}</p>}
                    {job && (
                      <div className="mt-1.5">
                        <ImportProgressPoller jobId={job.jobId} onDone={() => onDone()} />
                      </div>
                    )}
                  </div>
                  {!job && (
                    <button onClick={() => onDownload(v)} disabled={isPending}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-black accent-bg disabled:opacity-40 whitespace-nowrap">
                      ⬇ Baixar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-3xl mb-3">🔍</p>
          <p className="text-sm text-white/30">Nenhum vídeo encontrado.</p>
          <p className="text-xs text-white/20 mt-1">Tente a URL do canal principal ou de uma playlist pública.</p>
        </div>
      )}
    </div>
  );
}

function ImportProgressPoller({ jobId, onDone }: { jobId: string; onDone: (filename: string) => void }) {
  const { data } = useImportProgress(jobId, {
    query: {
      queryKey: ["importProgress", jobId],
      refetchInterval: (q) => q.state.data?.status === "downloading" ? 1500 : false,
    },
  });

  useEffect(() => {
    if (data?.status === "done" && data.filename) onDone(data.filename);
  }, [data?.status, data?.filename, onDone]);

  if (!data) return <div className="text-xs text-white/30 animate-pulse">Iniciando…</div>;
  if (data.status === "error") return <div className="text-xs text-red-400">❌ {data.error ?? "Erro ao baixar"}</div>;
  if (data.status === "done") return <div className="text-xs text-emerald-400">✅ {data.filename ?? "Concluído"}</div>;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-white/40">
        <span>Baixando…</span><span>{data.percent.toFixed(0)}%</span>
      </div>
      <div className="w-full bg-white/[0.06] rounded-full h-1">
        <div className="progress-fill h-1 rounded-full transition-all" style={{ width: `${data.percent}%` }} />
      </div>
    </div>
  );
}

// ── Session Card ──────────────────────────────────────────────────────────────

function SessionCard({ session, videos, onInvalidate }: {
  session: SessionState;
  videos: { filename: string; originalName: string }[];
  onInvalidate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(session.name);
  const [showStart, setShowStart] = useState(false);
  const [sk, setSk] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selVideo, setSelVideo] = useState(session.videoFile ?? "");
  const [fmt, setFmt] = useState<"landscape" | "shorts">("landscape");
  const [platformSel, setPlatformSel] = useState<StreamPlatform>("youtube");
  const [vol, setVol] = useState(session.volume);
  const [elapsed, setElapsed] = useState("00:00:00");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (session.isStreaming && session.startedAt) {
      timerRef.current = setInterval(() => setElapsed(formatDur(session.startedAt)), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed("00:00:00");
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [session.isStreaming, session.startedAt]);

  const renameM = useRenameSession({ mutation: { onSuccess: onInvalidate } });
  const startM = useStartSession({ mutation: { onSuccess: () => { setShowStart(false); onInvalidate(); } } });
  const stopM = useStopSession({ mutation: { onSuccess: onInvalidate } });
  const pauseM = usePauseSession({ mutation: { onSuccess: onInvalidate } });
  const resumeM = useResumeSession({ mutation: { onSuccess: onInvalidate } });
  const volM = useSetSessionVolume({ mutation: { onSuccess: onInvalidate } });
  const switchM = useSwitchSessionVideo({ mutation: { onSuccess: onInvalidate } });
  const deleteM = useDeleteSession({ mutation: { onSuccess: onInvalidate } });

  const isDefault = session.id === "default";
  const live = session.isStreaming;
  const paused = session.isPaused;
  const sess = session as SessionState & { isStable?: boolean; stabilizingSecondsLeft?: number | null; platform?: string };
  const isStable = sess.isStable ?? true;
  const stabilizingLeft = sess.stabilizingSecondsLeft ?? null;

  const statusColor = live && !paused && isStable ? "text-red-400" : live && !paused && !isStable ? "text-amber-400" : live && paused ? "text-amber-400" : "text-white/25";
  const statusLabel = live && !paused && isStable ? `● LIVE · ${elapsed}` : live && !paused && !isStable ? `⏳ Estabilizando… ${stabilizingLeft ?? ""}s` : live && paused ? "⏸ PAUSADO" : "● PARADO";

  return (
    <div className="card p-5 fade-in space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <form onSubmit={(e) => {
              e.preventDefault();
              if (nameVal.trim()) { renameM.mutate({ sessionId: session.id, data: { name: nameVal.trim() } }); }
              setEditing(false);
            }} className="flex gap-2">
              <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)}
                className="flex-1 bg-white/[0.06] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none" />
              <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-bold text-black accent-bg">✓</button>
              <button type="button" onClick={() => { setEditing(false); setNameVal(session.name); }}
                className="px-3 py-1.5 rounded-lg text-xs btn-ghost">✕</button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base truncate">{session.name}</h3>
              <button onClick={() => { setNameVal(session.name); setEditing(true); }}
                className="text-white/20 hover:text-white/50 transition-colors shrink-0" title="Renomear">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          )}
          <p className={`text-xs font-semibold mt-0.5 ${statusColor}`}>{statusLabel}</p>
          {live && session.videoFile && (
            <p className="text-[11px] text-white/30 mt-0.5 truncate">▶ {session.videoFile}</p>
          )}
        </div>

        {!isDefault && !live && (
          <button onClick={() => deleteM.mutate({ sessionId: session.id })}
            className="text-white/15 hover:text-red-400 transition-colors shrink-0 p-1" title="Deletar sessão">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Error */}
      {session.error && !live && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
          ⚠️ {session.error}
        </p>
      )}

      {/* Controls when live */}
      {live && (
        <div className="space-y-3">
          {/* Volume */}
          <div className="flex items-center gap-3">
            <div className="text-white/30"><VolumeIcon level={vol} /></div>
            <input type="range" min={0} max={100} value={vol}
              onChange={(e) => setVol(Number(e.target.value))}
              onMouseUp={() => volM.mutate({ sessionId: session.id, data: { volume: vol } })}
              onTouchEnd={() => volM.mutate({ sessionId: session.id, data: { volume: vol } })}
              className="flex-1 h-1" />
            <span className="text-xs text-white/30 w-7 text-right">{vol}%</span>
          </div>

          {/* Switch video */}
          {videos.length > 0 && (
            <div className="flex gap-2 items-center">
              <select value={selVideo} onChange={(e) => setSelVideo(e.target.value)}
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                {videos.map((v) => (
                  <option key={v.filename} value={v.filename}>{v.originalName}</option>
                ))}
              </select>
              <button onClick={() => { if (selVideo) switchM.mutate({ sessionId: session.id, data: { videoFile: selVideo } }); }}
                disabled={!selVideo || selVideo === session.videoFile}
                className="px-3 py-2 rounded-xl text-xs font-bold accent-bg text-black disabled:opacity-30 whitespace-nowrap">
                Trocar
              </button>
            </div>
          )}

          {/* Stabilizing warning */}
          {live && !paused && !isStable && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-400">
              ⏳ Aguardando estabilidade por {stabilizingLeft ?? "…"}s antes de habilitar controles de pausa.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {paused ? (
              <button onClick={() => resumeM.mutate({ sessionId: session.id })}
                disabled={resumeM.isPending}
                className="flex-1 py-2 rounded-xl text-sm font-bold text-black accent-bg disabled:opacity-40">
                ▶ Retomar
              </button>
            ) : (
              <button onClick={() => pauseM.mutate({ sessionId: session.id })}
                disabled={pauseM.isPending || !isStable}
                title={!isStable ? "Aguarde a stream estabilizar (20s)" : undefined}
                className="flex-1 py-2 rounded-xl text-sm font-semibold btn-ghost disabled:opacity-30">
                ⏸ Pausar
              </button>
            )}
            <button onClick={() => stopM.mutate({ sessionId: session.id })}
              disabled={stopM.isPending}
              className="flex-1 py-2 rounded-xl text-sm font-semibold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-colors disabled:opacity-40">
              ⏹ Parar Live
            </button>
          </div>
        </div>
      )}

      {/* Start form */}
      {!live && (
        <>
          {!showStart ? (
            <button onClick={() => setShowStart(true)}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-black accent-bg">
              ▶ Iniciar Live
            </button>
          ) : (
            <div className="space-y-3 card-inner p-4">
              {/* Platform selector */}
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(PLATFORM_LABELS) as StreamPlatform[]).map((p) => (
                  <button key={p} onClick={() => setPlatformSel(p)}
                    className={`py-2 rounded-xl text-xs font-semibold transition-all ${platformSel === p ? "accent-bg text-black" : "btn-ghost text-white/40"}`}>
                    {PLATFORM_LABELS[p]}
                  </button>
                ))}
              </div>

              <div className="relative">
                <input type={showKey ? "text" : "password"} value={sk} onChange={(e) => setSk(e.target.value)}
                  placeholder={`Stream Key — ${PLATFORM_LABELS[platformSel]}`}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none pr-12" />
                <button type="button" onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 text-xs">
                  {showKey ? "Ocultar" : "Mostrar"}
                </button>
              </div>

              <select value={selVideo} onChange={(e) => setSelVideo(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none">
                <option value="">— Escolha um vídeo —</option>
                {videos.map((v) => (
                  <option key={v.filename} value={v.filename}>{v.originalName}</option>
                ))}
              </select>

              <div className="flex gap-2">
                {(["landscape", "shorts"] as const).map((f) => (
                  <button key={f} onClick={() => setFmt(f)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${fmt === f ? "accent-bg text-black" : "btn-ghost text-white/50"}`}>
                    {f === "landscape" ? "🖥 16:9" : "📱 Shorts"}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <VolumeIcon level={vol} />
                <input type="range" min={0} max={100} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="flex-1" />
                <span className="text-xs text-white/30 w-7">{vol}%</span>
              </div>

              <div className="flex gap-2">
                <button onClick={() => {
                  if (!sk.trim() || !selVideo) return;
                  startM.mutate({ sessionId: session.id, data: { streamKey: sk.trim(), videoFile: selVideo, format: fmt, volume: vol, platform: platformSel } as Parameters<typeof startM.mutate>[0]["data"] });
                }}
                  disabled={!sk.trim() || !selVideo || startM.isPending}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-black accent-bg disabled:opacity-30">
                  {startM.isPending ? "Iniciando…" : `🔴 Ir ao Vivo · ${PLATFORM_LABELS[platformSel]}`}
                </button>
                <button onClick={() => setShowStart(false)} className="px-4 py-2.5 rounded-xl text-sm btn-ghost">
                  Cancelar
                </button>
              </div>

              {startM.isError && (
                <p className="text-xs text-red-400">
                  {(startM.error as { data?: { error?: string } })?.data?.error ?? "Erro ao iniciar"}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
function StreamerApp() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("stream");
  const [accent, setAccent] = useState(() => localStorage.getItem("accent") || "#FF0000");
  const [showSettings, setShowSettings] = useState(false);
  const [backendUrl, setBackendUrlState] = useState(getSavedBackendUrl);
  const [backendUrlDraft, setBackendUrlDraft] = useState(getSavedBackendUrl);
  const [streamKey, setStreamKey] = useState("");
  const [selectedVideo, setSelectedVideo] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [format, setFormat] = useState<"landscape" | "shorts">("landscape");
  const [volume, setVolume] = useState(100);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [elapsed, setElapsed] = useState("00:00:00");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleCountdown, setScheduleCountdown] = useState("");
  const [scheduleActive, setScheduleActive] = useState(false);
  const [autoRestart, setAutoRestart] = useState(() => localStorage.getItem("autoRestart") === "true");
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null);
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<"ok" | "fail" | null>(null);
  const [platform, setPlatform] = useState<StreamPlatform>("youtube");

  // Playlist
  const [playlist, setPlaylist] = useState<string[]>([]);
  const [usePlaylistMode, setUsePlaylistMode] = useState(false);

  // Import
  const [channelUrl, setChannelUrl] = useState("");
  const [importLimit, setImportLimit] = useState(20);
  const [importSort, setImportSort] = useState<"newest" | "oldest">("newest");
  const [downloadJobs, setDownloadJobs] = useState<{ jobId: string; title: string }[]>([]);

  // Duplo stream (landscape + shorts simultaneously)
  const [duploMode, setDuploMode] = useState(false);
  const [streamKeyShorts, setStreamKeyShorts] = useState("");
  const [showKeyShorts, setShowKeyShorts] = useState(false);
  const [duploStarting, setDuploStarting] = useState(false);

  // Thumbnail
  const [thumbFilename, setThumbFilename] = useState<string | null>(null);
  const [thumbUploading, setThumbUploading] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // New session
  const [newSessionName, setNewSessionName] = useState("");
  const [showNewSession, setShowNewSession] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const schedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartCdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStreaming = useRef<boolean | null>(null);
  const lastParams = useRef<{ streamKey: string; videoFile: string; format: "landscape" | "shorts"; volume: number; playlist: string[] } | null>(null);

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
  const { data: videos = [] } = useListVideos({
    query: { queryKey: getListVideosQueryKey(), enabled: !needsBackend },
  });
  const { data: sessions = [] } = useListSessions({
    query: { queryKey: getListSessionsQueryKey(), refetchInterval: 3000, enabled: !needsBackend },
  });

  const inv = useCallback(() => qc.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() }), [qc]);
  const invVideos = useCallback(() => qc.invalidateQueries({ queryKey: getListVideosQueryKey() }), [qc]);
  const invSessions = useCallback(() => qc.invalidateQueries({ queryKey: getListSessionsQueryKey() }), [qc]);

  const startM = useStartStream({ mutation: { onSuccess: () => { inv(); invSessions(); } } });
  const stopM = useStopStream({ mutation: { onSuccess: () => { inv(); invSessions(); } } });
  const pauseM = usePauseStream({ mutation: { onSuccess: () => { inv(); invSessions(); } } });
  const resumeM = useResumeStream({ mutation: { onSuccess: () => { inv(); invSessions(); } } });
  const volumeM = useSetVolume({ mutation: { onSuccess: inv } });
  const switchM = useSwitchVideo({ mutation: { onSuccess: inv } });
  const playlistM = useUpdatePlaylist({ mutation: { onSuccess: inv } });
  const deleteVideoM = useDeleteVideo({
    mutation: {
      onSuccess: (_d, { filename }) => {
        invVideos();
        if (selectedVideo === filename) setSelectedVideo("");
        setPlaylist((p) => p.filter((f) => f !== filename));
      },
    },
  });
  const createSessionM = useCreateSession({
    mutation: {
      onSuccess: () => { invSessions(); setShowNewSession(false); setNewSessionName(""); },
    },
  });
  const importListM = useImportChannelList();
  const importDownloadM = useImportDownload({
    mutation: { onSuccess: (data) => setDownloadJobs((j) => [...j, { jobId: data.jobId, title: data.title }]) },
  });

  const isStreaming = status?.isStreaming ?? false;
  const isPaused = status?.isPaused ?? false;
  const serverVolume = status?.volume ?? 100;
  const serverPlaylist = status?.playlist ?? [];
  const serverPlaylistIndex = status?.playlistIndex ?? 0;
  const statusExt = status as (typeof status & { isStable?: boolean; stabilizingSecondsLeft?: number | null }) | undefined;
  const isStable = statusExt?.isStable ?? true;
  const mainStabilizingLeft = statusExt?.stabilizingSecondsLeft ?? null;

  const startTimer = useCallback((at: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(formatDur(at)), 1000);
  }, []);

  useEffect(() => {
    if (isStreaming && status?.startedAt) startTimer(status.startedAt);
    else { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } setElapsed("00:00:00"); }
  }, [isStreaming, status?.startedAt, startTimer]);

  useEffect(() => {
    if (prevStreaming.current === null) { prevStreaming.current = isStreaming; return; }
    const was = prevStreaming.current; prevStreaming.current = isStreaming;
    if (was && !isStreaming && status?.error && autoRestart && lastParams.current) {
      let s = 10; setRestartCountdown(s);
      restartCdRef.current = setInterval(() => { s--; if (s <= 0) { clearInterval(restartCdRef.current!); setRestartCountdown(null); } else setRestartCountdown(s); }, 1000);
      restartTimerRef.current = setTimeout(() => { if (lastParams.current) startM.mutate({ data: lastParams.current }); }, 10000);
    }
    if (isStreaming) { if (restartTimerRef.current) clearTimeout(restartTimerRef.current); if (restartCdRef.current) clearInterval(restartCdRef.current); setRestartCountdown(null); }
  }, [isStreaming]); // eslint-disable-line

  useEffect(() => {
    if (!scheduleActive || !scheduleTime) return;
    const target = getScheduleTarget(scheduleTime); if (!target) return;
    schedTimerRef.current = setInterval(() => {
      const rem = target.getTime() - Date.now();
      if (rem <= 0) {
        clearInterval(schedTimerRef.current!); setScheduleActive(false); setScheduleCountdown("");
        if (!isStreaming && streamKey.trim() && selectedVideo) {
          const p = { streamKey: streamKey.trim(), videoFile: selectedVideo, format, volume, playlist: usePlaylistMode ? playlist : [] };
          lastParams.current = p; startM.mutate({ data: p });
        }
      } else setScheduleCountdown(fmtCountdown(rem));
    }, 1000);
    return () => { if (schedTimerRef.current) clearInterval(schedTimerRef.current); };
  }, [scheduleActive]); // eslint-disable-line

  function getUploadUrl() { return backendUrl ? `${backendUrl}/api/stream/upload` : `${BASE}/api/stream/upload`; }

  async function handleUpload(file: File) {
    setUploading(true); setUploadError(""); setUploadProgress(0);
    const form = new FormData(); form.append("video", file);
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", getUploadUrl());
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 200) { try { const d = JSON.parse(xhr.responseText); invVideos(); setSelectedVideo(d.filename); resolve(); } catch { setUploadError("Resposta inválida"); reject(); } }
        else { try { setUploadError(JSON.parse(xhr.responseText).error || "Upload falhou"); } catch { setUploadError(`Upload falhou (${xhr.status})`); } reject(); }
      };
      xhr.onerror = () => { setUploading(false); setUploadError("Erro de conexão"); reject(); };
      xhr.send(form);
    });
  }

  async function testConnection() {
    const url = normalizeBackendUrl(backendUrlDraft); if (!url) return;
    setTestingConn(true); setConnResult(null);
    try { const r = await fetch(`${url}/api/healthz`, { signal: AbortSignal.timeout(8000) }); setConnResult(r.ok ? "ok" : "fail"); }
    catch { setConnResult("fail"); } finally { setTestingConn(false); }
  }

  function saveBackendUrl() {
    const n = normalizeBackendUrl(backendUrlDraft);
    applyBackendUrl(n); setBackendUrlDraft(n); setBackendUrlState(n); setConnResult(null);
    inv(); invVideos(); invSessions();
  }

  function handleStart() {
    if (!streamKey.trim() || !selectedVideo) return;
    const pl = usePlaylistMode && playlist.length > 1 ? playlist : [];
    const p = { streamKey: streamKey.trim(), videoFile: selectedVideo, format, volume, playlist: pl, platform };
    lastParams.current = p as typeof lastParams.current; startM.mutate({ data: p as Parameters<typeof startM.mutate>[0]["data"] });
  }

  async function handleDuploStart() {
    if (!streamKey.trim() || !streamKeyShorts.trim() || !selectedVideo) return;
    setDuploStarting(true);
    try {
      const apiBase = backendUrl ? `${backendUrl}/api/stream` : `${BASE}/api/stream`;
      const headers = { "Content-Type": "application/json" };
      const [r1, r2] = await Promise.all([
        fetch(`${apiBase}/sessions`, { method: "POST", headers, body: JSON.stringify({ name: "Live Landscape (16:9)" }) }),
        fetch(`${apiBase}/sessions`, { method: "POST", headers, body: JSON.stringify({ name: "Live Shorts (9:16)" }) }),
      ]);
      const [sess1, sess2] = await Promise.all([r1.json(), r2.json()]);
      if (!sess1.id || !sess2.id) throw new Error("Falha ao criar sessões");
      await Promise.all([
        fetch(`${apiBase}/sessions/${sess1.id}/start`, { method: "POST", headers, body: JSON.stringify({ streamKey: streamKey.trim(), videoFile: selectedVideo, format: "landscape", volume }) }),
        fetch(`${apiBase}/sessions/${sess2.id}/start`, { method: "POST", headers, body: JSON.stringify({ streamKey: streamKeyShorts.trim(), videoFile: selectedVideo, format: "shorts", volume }) }),
      ]);
      invSessions();
      setTab("sessions");
    } catch (e) {
      alert("Erro ao iniciar stream duplo: " + (e instanceof Error ? e.message : "desconhecido"));
    } finally {
      setDuploStarting(false);
    }
  }

  async function handleThumbUpload(file: File) {
    setThumbUploading(true);
    const form = new FormData(); form.append("thumbnail", file);
    const url = backendUrl ? `${backendUrl}/api/stream/thumbnail` : `${BASE}/api/stream/thumbnail`;
    try {
      const r = await fetch(url, { method: "POST", body: form });
      const data = await r.json();
      if (r.ok && data.filename) setThumbFilename(data.filename);
    } catch { /* ignore */ } finally { setThumbUploading(false); }
  }

  function getThumbUrl(filename: string) {
    const base = backendUrl ? `${backendUrl}/api/stream` : `${BASE}/api/stream`;
    return `${base}/thumbnail/view/${filename}`;
  }

  function handleVolumeChange(v: number) { setVolume(v); if (isStreaming) volumeM.mutate({ data: { volume: v } }); }
  function handleSchedule() { const t = getScheduleTarget(scheduleTime); if (!t) return; setScheduleActive(true); setScheduleCountdown(fmtCountdown(t.getTime() - Date.now())); }
  function addToPlaylist(fn: string) { if (!playlist.includes(fn)) { const n = [...playlist, fn]; setPlaylist(n); if (isStreaming) playlistM.mutate({ data: { playlist: n } }); } }
  function removeFromPlaylist(i: number) { const n = playlist.filter((_, j) => j !== i); setPlaylist(n); if (isStreaming) playlistM.mutate({ data: { playlist: n } }); }
  function moveInPlaylist(from: number, to: number) { const n = [...playlist]; const [item] = n.splice(from, 1); n.splice(to, 0, item!); setPlaylist(n); if (isStreaming) playlistM.mutate({ data: { playlist: n } }); }

  const canStart = !!(streamKey.trim() && selectedVideo && !isStreaming && !startM.isPending && !uploading && !needsBackend);
  const accentRgb = hexToRgb(accent);
  const activeLives = sessions.filter((s) => s.isStreaming).length;

  return (
    <div className="min-h-screen text-white font-sans" style={{ background: "#080808" }}>
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
        .card{background:#111;border:1px solid rgba(255,255,255,0.05);border-radius:20px;}
        .card-inner{background:#0d0d0d;border:1px solid rgba(255,255,255,0.04);border-radius:14px;}
        .step-num{background:var(--accent);color:#000;font-weight:700;}
        .swatch-active{outline:2px solid white;outline-offset:2px;}
        .video-selected{border-color:rgba(var(--accent-rgb),0.5)!important;background:rgba(var(--accent-rgb),0.07)!important;}
        .btn-ghost{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);}
        .btn-ghost:hover{background:rgba(255,255,255,0.08);}
        .tab-active{color:white;border-bottom:2px solid var(--accent);}
        .tab-inactive{color:rgba(255,255,255,0.3);border-bottom:2px solid transparent;}
        input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;}
        input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:99px;background:rgba(255,255,255,0.1);}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--accent);margin-top:-6px;box-shadow:0 0 8px rgba(var(--accent-rgb),0.5);}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeIn .3s ease}
        @keyframes pulse-ring{0%{transform:scale(1);opacity:0.8}100%{transform:scale(1.5);opacity:0}}
        .live-ring{animation:pulse-ring 1.5s ease-out infinite;}
        .playlist-item{background:#111;border:1px solid rgba(255,255,255,0.05);border-radius:14px;}
        .playlist-item.active{border-color:rgba(var(--accent-rgb),0.4);background:rgba(var(--accent-rgb),0.06);}
      `}</style>

      {/* NAV */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.04]" style={{ background: "rgba(8,8,8,0.92)", backdropFilter: "blur(16px)" }}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl accent-bg flex items-center justify-center shrink-0 accent-glow">
            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
          <span className="font-bold tracking-tight">LiveStream Loop</span>

          {(isStreaming || activeLives > 0) && (
            <div className="relative ml-1 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold live-badge fade-in">
              <span className="relative flex h-2 w-2">
                <span className="live-ring absolute inline-flex h-full w-full rounded-full live-dot opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 live-dot" />
              </span>
              {activeLives > 1 ? `${activeLives} LIVES ATIVAS` : isPaused ? "⏸ PAUSADO" : `LIVE · ${elapsed}`}
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4 flex gap-0 overflow-x-auto">
          {([
            ["stream", "🔴 Stream"],
            ["playlist", "📋 Playlist"],
            ["sessions", `📡 Minhas Lives${activeLives > 0 ? ` (${activeLives})` : ""}`],
            ["import", "📥 Importar"],
            ["packs", "📦 Packs"],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all ${tab === t ? "tab-active" : "tab-inactive hover:text-white/50"}`}>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Settings */}
      {showSettings && (
        <div className="border-b border-white/[0.04] px-4 py-5 fade-in" style={{ background: "#0d0d0d" }}>
          <div className="max-w-5xl mx-auto space-y-5">
            <div>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-2">
                Backend URL {IS_GITHUB_PAGES && <span className="text-amber-400 ml-1 normal-case">— obrigatório no GitHub Pages</span>}
              </p>
              <div className="flex gap-2">
                <input type="text" value={backendUrlDraft} onChange={(e) => { setBackendUrlDraft(e.target.value); setConnResult(null); }}
                  placeholder="youtubelivestreamer-production.up.railway.app"
                  className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/20" />
                <button onClick={testConnection} disabled={testingConn || !backendUrlDraft.trim()}
                  className="px-3 py-2.5 rounded-xl text-sm font-semibold btn-ghost disabled:opacity-40 whitespace-nowrap">
                  {testingConn ? "…" : "Testar"}
                </button>
                <button onClick={saveBackendUrl} className="px-4 py-2.5 rounded-xl text-sm font-bold text-black accent-bg whitespace-nowrap">Salvar</button>
              </div>
              {connResult === "ok" && <p className="text-xs text-emerald-400 mt-1.5">✅ Conectado! Clique em Salvar.</p>}
              {connResult === "fail" && <p className="text-xs text-red-400 mt-1.5">❌ Não foi possível conectar.</p>}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-2">Cor de destaque</p>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map((c) => (
                  <button key={c.value} title={c.name} onClick={() => setAccent(c.value)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${accent === c.value ? "swatch-active scale-110" : "border-transparent"}`}
                    style={{ background: c.value }} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setAutoRestart(!autoRestart)}
                className={`relative w-11 h-6 rounded-full transition-colors ${autoRestart ? "accent-bg" : "bg-white/10"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${autoRestart ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
              <div>
                <p className="text-sm font-medium">Auto-reiniciar</p>
                <p className="text-xs text-white/30">Reinicia automaticamente se a live cair</p>
              </div>
            </div>
            {/* Redeploy warning */}
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <p className="text-xs font-bold text-amber-400 mb-1">⚠️ Por que minha live parou?</p>
              <p className="text-xs text-white/40 leading-relaxed">
                Toda vez que o Railway faz redeploy do backend (ex: quando o GitHub detecta um push de código), o servidor reinicia e o FFmpeg é encerrado. Evite fazer push enquanto estiver ao vivo, ou ative o "Auto-reiniciar" acima para reconectar automaticamente.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {needsBackend && (
          <div className="card p-6 fade-in border-amber-500/20">
            <p className="font-bold text-amber-400 mb-1">⚙️ Configure o Backend</p>
            <p className="text-sm text-white/40">Abra as configurações (⚙️) e cole a URL do Railway para conectar ao servidor.</p>
          </div>
        )}

        {/* ══════════════ TAB: STREAM ══════════════ */}
        {tab === "stream" && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Left: Setup */}
            <div className="space-y-5">
              {/* Stream Key */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="step-num w-6 h-6 rounded-full text-xs flex items-center justify-center">1</span>
                    <h2 className="font-bold text-sm">Stream Key do YouTube</h2>
                  </div>
                  <button onClick={() => { if (!isStreaming) setDuploMode(!duploMode); }}
                    disabled={isStreaming}
                    title="Stream duplo: landscape + shorts ao mesmo tempo"
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40 ${duploMode ? "accent-bg text-black" : "btn-ghost text-white/50"}`}>
                    🔀 Duplo
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="relative">
                    <input type={showKey ? "text" : "password"} value={streamKey}
                      onChange={(e) => setStreamKey(e.target.value)} disabled={isStreaming}
                      placeholder={duploMode ? "Landscape key (16:9)" : "xxxx-xxxx-xxxx-xxxx-xxxx"}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none disabled:opacity-40 pr-20" />
                    <button type="button" onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/25 hover:text-white/60">
                      {showKey ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                  {duploMode && (
                    <div className="relative">
                      <input type={showKeyShorts ? "text" : "password"} value={streamKeyShorts}
                        onChange={(e) => setStreamKeyShorts(e.target.value)} disabled={isStreaming}
                        placeholder="Shorts key (9:16)"
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none disabled:opacity-40 pr-20" />
                      <button type="button" onClick={() => setShowKeyShorts(!showKeyShorts)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/25 hover:text-white/60">
                        {showKeyShorts ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                  )}
                </div>
                {duploMode ? (
                  <p className="text-[11px] text-white/20 mt-2">🔀 Duas lives simultâneas: 16:9 e Shorts (9:16)</p>
                ) : (
                  <p className="text-[11px] text-white/20 mt-2">YouTube Studio → Ir ao Vivo → Chave de stream</p>
                )}
              </div>

              {/* Thumbnail */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="step-num w-6 h-6 rounded-full text-xs flex items-center justify-center">🖼</span>
                    <h2 className="font-bold text-sm">Thumbnail</h2>
                  </div>
                  <label className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${thumbUploading ? "opacity-40 cursor-wait" : "btn-ghost hover:opacity-80"}`}>
                    {thumbUploading ? "Enviando…" : thumbFilename ? "Trocar" : "+ Upload"}
                    <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" disabled={thumbUploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleThumbUpload(f); e.target.value = ""; } }} />
                  </label>
                </div>
                {thumbFilename ? (
                  <div className="relative group">
                    <img src={getThumbUrl(thumbFilename)} alt="Thumbnail"
                      className="w-full rounded-xl object-cover max-h-32 bg-white/[0.04]" />
                    <button onClick={() => setThumbFilename(null)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white/60 hover:text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      ✕
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-white/20">Opcional — aparece nas miniaturas do YouTube</p>
                )}
              </div>

              {/* Video */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="step-num w-6 h-6 rounded-full text-xs flex items-center justify-center">2</span>
                    <h2 className="font-bold text-sm">Vídeo</h2>
                  </div>
                  <label className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${uploading ? "opacity-40 cursor-wait" : "btn-ghost hover:opacity-80"}`}>
                    {uploading ? `${uploadProgress}%…` : "+ Upload"}
                    <input ref={fileInputRef} type="file" accept="video/*" className="hidden" disabled={uploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleUpload(f).catch(() => {}); e.target.value = ""; } }} />
                  </label>
                </div>
                {uploadError && <p className="text-xs text-red-400 mb-3">❌ {uploadError}</p>}
                {uploading && (
                  <div className="mb-3">
                    <div className="w-full bg-white/[0.06] rounded-full h-1.5"><div className="progress-fill h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} /></div>
                  </div>
                )}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
                  {videos.length === 0 && !uploading && (
                    <p className="text-xs text-white/20 text-center py-4">Nenhum vídeo. Faça upload ou importe do YouTube.</p>
                  )}
                  {videos.map((v) => {
                    const isSel = selectedVideo === v.filename;
                    return (
                      <div key={v.filename} onClick={() => { if (!isStreaming) setSelectedVideo(v.filename); }}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all border-white/[0.05] ${isSel ? "video-selected" : "hover:bg-white/[0.03]"} ${isStreaming ? "cursor-default" : ""}`}>
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isSel ? "accent-bg" : "bg-white/10"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{v.originalName}</p>
                          <p className="text-[10px] text-white/25">{formatBytes(v.size)}</p>
                        </div>
                        {/* Switch mid-stream */}
                        {isStreaming && !isSel && (
                          <button onClick={(e) => { e.stopPropagation(); switchM.mutate({ data: { videoFile: v.filename } }); }}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold accent-bg text-black whitespace-nowrap">
                            Trocar
                          </button>
                        )}
                        {!isStreaming && (
                          <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Deletar "${v.originalName}"?`)) deleteVideoM.mutate({ filename: v.filename }); }}
                            className="text-white/15 hover:text-red-400 transition-colors p-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                        {!isStreaming && (
                          <button onClick={(e) => { e.stopPropagation(); addToPlaylist(v.filename); }}
                            title="Adicionar à playlist"
                            className={`text-white/15 hover:text-white/60 transition-colors p-1 ${playlist.includes(v.filename) ? "accent-text" : ""}`}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Format + volume */}
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="step-num w-6 h-6 rounded-full text-xs flex items-center justify-center">3</span>
                  <h2 className="font-bold text-sm">Plataforma, Formato & Áudio</h2>
                </div>
                {/* Platform selector */}
                {!duploMode && (
                  <div className="grid grid-cols-2 gap-1.5 mb-3">
                    {(Object.keys(PLATFORM_LABELS) as StreamPlatform[]).map((p) => (
                      <button key={p} onClick={() => { if (!isStreaming) setPlatform(p); }} disabled={isStreaming}
                        className={`py-2 rounded-xl text-xs font-semibold transition-all ${platform === p ? "accent-bg text-black" : "btn-ghost text-white/40"} disabled:opacity-40`}>
                        {PLATFORM_LABELS[p]}
                      </button>
                    ))}
                  </div>
                )}
                <div className={`grid gap-2 mb-4 ${duploMode ? "grid-cols-1" : "grid-cols-2"}`}>
                  {duploMode ? (
                    <div className="py-2.5 rounded-xl text-sm font-semibold text-center accent-bg text-black">
                      🔀 Duplo: 16:9 + 9:16 simultâneos
                    </div>
                  ) : (
                    (["landscape", "shorts"] as const).map((f) => (
                      <button key={f} onClick={() => setFormat(f)} disabled={isStreaming}
                        className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${format === f ? "accent-bg text-black" : "btn-ghost text-white/50"} disabled:opacity-40`}>
                        {f === "landscape" ? "🖥 16:9 (Normal)" : "📱 9:16 (Shorts)"}
                      </button>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-white/40"><VolumeIcon level={volume} /></div>
                  <input type="range" min={0} max={100} value={volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))} className="flex-1 h-1" />
                  <span className="text-xs text-white/30 w-7 text-right">{volume}%</span>
                </div>
              </div>

              {/* Playlist mode toggle */}
              {playlist.length > 1 && (
                <div className="card p-4">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setUsePlaylistMode(!usePlaylistMode)} disabled={isStreaming}
                      className={`relative w-11 h-6 rounded-full transition-colors ${usePlaylistMode ? "accent-bg" : "bg-white/10"} disabled:opacity-40`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${usePlaylistMode ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                    <div>
                      <p className="text-sm font-medium">Modo Playlist</p>
                      <p className="text-xs text-white/30">{playlist.length} vídeos · avança automaticamente</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Status + controls */}
            <div className="space-y-5">
              {/* Status card */}
              <div className="card p-5">
                {isStreaming ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="relative w-10 h-10 rounded-full accent-bg flex items-center justify-center accent-glow">
                        <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        <div className="absolute -inset-1 rounded-full accent-bg opacity-20 live-ring" />
                      </div>
                      <div>
                        <p className="font-bold text-lg">{isPaused ? "⏸ Pausado" : "🔴 Ao Vivo"}</p>
                        <p className="text-sm text-white/40">{elapsed}</p>
                      </div>
                    </div>
                    {status?.videoFile && (
                      <p className="text-xs text-white/30 truncate">▶ {status.videoFile}</p>
                    )}
                    {status?.loopMode === "playlist" && (
                      <p className="text-xs text-white/25">📋 Vídeo {(status.playlistIndex ?? 0) + 1}/{status.playlist?.length ?? 1} da playlist</p>
                    )}
                    {status?.error && (
                      <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">⚠️ {status.error}</p>
                    )}
                    {restartCountdown !== null && (
                      <p className="text-xs text-amber-400">♻️ Reiniciando em {restartCountdown}s…</p>
                    )}
                    {isStreaming && !isPaused && !isStable && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-400">
                        ⏳ Estabilizando… {mainStabilizingLeft ?? ""}s — Pausar ficará disponível após estabilização.
                      </div>
                    )}
                    <div className="flex gap-2">
                      {isPaused ? (
                        <button onClick={() => resumeM.mutate()} disabled={resumeM.isPending}
                          className="flex-1 py-3 rounded-xl font-bold accent-bg text-black disabled:opacity-40">
                          ▶ Retomar
                        </button>
                      ) : (
                        <button onClick={() => pauseM.mutate()} disabled={pauseM.isPending || !isStable}
                          title={!isStable ? "Aguarde a stream estabilizar (20s)" : undefined}
                          className="flex-1 py-3 rounded-xl font-semibold btn-ghost disabled:opacity-30">
                          ⏸ Pausar
                        </button>
                      )}
                      <button onClick={() => stopM.mutate()} disabled={stopM.isPending}
                        className="flex-1 py-3 rounded-xl font-semibold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-colors">
                        ⏹ Parar
                      </button>
                    </div>
                    {serverPlaylist.length > 1 && (
                      <div className="pt-2 border-t border-white/[0.05]">
                        <p className="text-[11px] text-white/25 mb-2">Fila da playlist</p>
                        {serverPlaylist.map((f, i) => (
                          <div key={i} className={`flex items-center gap-2 py-1 text-xs ${i === serverPlaylistIndex ? "accent-text font-semibold" : "text-white/30"}`}>
                            {i === serverPlaylistIndex ? "▶" : <span className="w-3">{i + 1}</span>}
                            <span className="truncate">{f}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
                      <svg className="w-7 h-7 fill-white/20" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                    <p className="font-semibold text-white/60 mb-1">Pronto para ir ao vivo</p>
                    <p className="text-xs text-white/25">Configure stream key e vídeo</p>
                  </div>
                )}
              </div>

              {/* Schedule */}
              {!isStreaming && (
                <div className="card p-5">
                  <h3 className="font-bold text-sm mb-3">⏰ Agendar Início</h3>
                  <div className="flex gap-2">
                    <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                      disabled={scheduleActive}
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none disabled:opacity-40" />
                    {scheduleActive ? (
                      <button onClick={() => { setScheduleActive(false); setScheduleCountdown(""); if (schedTimerRef.current) clearInterval(schedTimerRef.current); }}
                        className="px-4 py-2.5 rounded-xl text-sm font-bold text-red-400 border border-red-500/20">
                        Cancelar {scheduleCountdown}
                      </button>
                    ) : (
                      <button onClick={handleSchedule} disabled={!scheduleTime || !streamKey.trim() || !selectedVideo}
                        className="px-4 py-2.5 rounded-xl text-sm font-bold btn-ghost disabled:opacity-30">
                        Agendar
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Start button */}
              {!isStreaming && (
                duploMode ? (
                  <button onClick={handleDuploStart}
                    disabled={!streamKey.trim() || !streamKeyShorts.trim() || !selectedVideo || duploStarting || uploading || needsBackend}
                    className="w-full py-4 rounded-2xl text-base font-bold text-black accent-bg accent-glow transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                    {duploStarting ? "Iniciando Duplo…" : "🔀 Iniciar Live Duplo"}
                  </button>
                ) : (
                  <button onClick={handleStart} disabled={!canStart}
                    className="w-full py-4 rounded-2xl text-base font-bold text-black accent-bg accent-glow transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                    {startM.isPending ? "Iniciando…" : "🔴 Iniciar Live"}
                  </button>
                )
              )}
              {startM.isError && (
                <p className="text-xs text-red-400 text-center">
                  {(startM.error as { data?: { error?: string } })?.data?.error ?? "Erro ao iniciar"}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ══════════════ TAB: PLAYLIST ══════════════ */}
        {tab === "playlist" && (
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="card p-5">
              <h2 className="font-bold mb-1">📋 Playlist</h2>
              <p className="text-xs text-white/30 mb-5">Adicione vídeos, reordene, e o servidor avança automaticamente.</p>
              {playlist.length === 0 ? (
                <div className="text-center py-10 text-white/20">
                  <p className="text-3xl mb-3">📋</p>
                  <p className="text-sm">Adicione vídeos pela aba <strong>Stream</strong></p>
                </div>
              ) : (
                <div className="space-y-2">
                  {playlist.map((fn, i) => {
                    const v = videos.find((vi) => vi.filename === fn);
                    const isActive = isStreaming && serverPlaylist[serverPlaylistIndex] === fn;
                    return (
                      <div key={fn} className={`playlist-item flex items-center gap-3 p-3 ${isActive ? "active" : ""}`}>
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => i > 0 && moveInPlaylist(i, i - 1)} disabled={i === 0} className="text-white/20 hover:text-white/60 disabled:opacity-0 text-xs">▲</button>
                          <button onClick={() => i < playlist.length - 1 && moveInPlaylist(i, i + 1)} disabled={i === playlist.length - 1} className="text-white/20 hover:text-white/60 disabled:opacity-0 text-xs">▼</button>
                        </div>
                        <span className="text-xs text-white/20 w-5 text-center">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{v?.originalName ?? fn}</p>
                          {isActive && <p className="text-[10px] accent-text font-semibold">▶ Tocando agora</p>}
                        </div>
                        <button onClick={() => removeFromPlaylist(i)} className="text-white/15 hover:text-red-400 transition-colors p-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Add from library */}
            {videos.filter((v) => !playlist.includes(v.filename)).length > 0 && (
              <div className="card p-5">
                <h3 className="font-bold text-sm mb-3">+ Adicionar da biblioteca</h3>
                <div className="space-y-2">
                  {videos.filter((v) => !playlist.includes(v.filename)).map((v) => (
                    <div key={v.filename} className="flex items-center gap-3 p-2">
                      <div className="flex-1 min-w-0"><p className="text-xs truncate text-white/50">{v.originalName}</p></div>
                      <button onClick={() => addToPlaylist(v.filename)} className="px-3 py-1.5 rounded-lg text-xs font-bold accent-bg text-black">+ Adicionar</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TAB: PACKS ══════════════ */}
        {tab === "packs" && (
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-4">
              <p className="text-sm font-bold text-amber-400 mb-1">⚠️ Aviso de Tráfego Intenso</p>
              <p className="text-xs text-white/50 leading-relaxed">
                Todos os 4 packs estão no Google Drive e exigem login para baixar. Sistema projetado para tráfego intenso com pacotes pesados de 1 GB a 10 GB. Use uma conexão estável e Wi-Fi para baixar.
              </p>
            </div>

            {[
              {
                icon: "📽️",
                title: "PACK SEPARADO",
                description: "Recortes isolados e mídias avulsas.",
                link: "https://drive.google.com/drive/folders/1LGgJkpPTATh2NyPSb4dfWpdiOiwlAfG6?usp=drive_link",
                password: null,
              },
              {
                icon: "📸",
                title: "PACK COMPLETO (iGust)",
                description: "Overlays de alta resolução, mídias e templates.",
                link: "https://drive.google.com/file/d/1h99LD7bHO19vjfChBcSIdy6Qf_gRdczk/view",
                password: "gustit",
              },
              {
                icon: "📁",
                title: "PACK DE MEMES E EFEITOS (João Dias Tech)",
                description: "Áudios de memes virais, transições e efeitos visuais.",
                link: "https://drive.google.com/file/d/1JrWqR14xX9idVFoPuFkdW_-4ClwkCYcY/view?usp=sharing",
                password: null,
              },
              {
                icon: "🎵",
                title: "PACK DE MEZCLA / SOUND EFFECTS",
                description: "Efeitos de som, batidas e trilhas limpas.",
                link: "https://drive.google.com/drive/folders/1HCqd9TRGvktSj5T6Kd2V4DzzZA05sVq1?usp=drive_link",
                password: "gustedit",
              },
            ].map((pack) => (
              <div key={pack.title} className="card p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{pack.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm leading-tight">{pack.title}</h3>
                    <p className="text-xs text-white/40 mt-0.5">{pack.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {pack.password && (
                    <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2">
                      <span className="text-xs text-white/30">🔑 Senha:</span>
                      <span className="text-sm font-bold font-mono tracking-widest accent-text select-all">{pack.password}</span>
                    </div>
                  )}
                  <a href={pack.link} target="_blank" rel="noopener noreferrer"
                    className="flex-1 min-w-[140px] py-2.5 rounded-xl text-sm font-bold text-black accent-bg text-center transition-all hover:brightness-110">
                    ⬇ Baixar do Drive
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════════════ TAB: MINHAS LIVES (SESSIONS) ══════════════ */}
        {tab === "sessions" && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">📡 Minhas Lives</h2>
                <p className="text-xs text-white/30 mt-0.5">Gerencie múltiplas lives simultâneas em canais diferentes</p>
              </div>
              <button onClick={() => setShowNewSession(!showNewSession)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-black accent-bg">
                <span className="text-lg leading-none">+</span> Nova Live
              </button>
            </div>

            {/* Create session form */}
            {showNewSession && (
              <div className="card p-5 fade-in">
                <h3 className="font-bold text-sm mb-3">Criar nova sessão de live</h3>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (newSessionName.trim()) createSessionM.mutate({ data: { name: newSessionName.trim() } });
                }} className="flex gap-2">
                  <input autoFocus value={newSessionName} onChange={(e) => setNewSessionName(e.target.value)}
                    placeholder='Ex: "Live de Minecraft", "Canal Gaming"…'
                    className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none" />
                  <button type="submit" disabled={!newSessionName.trim() || createSessionM.isPending}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-black accent-bg disabled:opacity-30 whitespace-nowrap">
                    {createSessionM.isPending ? "Criando…" : "Criar"}
                  </button>
                  <button type="button" onClick={() => setShowNewSession(false)}
                    className="px-4 py-2.5 rounded-xl text-sm btn-ghost">Cancelar</button>
                </form>
              </div>
            )}

            {/* Session cards */}
            {sessions.length === 0 ? (
              <div className="card p-12 text-center">
                <p className="text-4xl mb-4">📡</p>
                <p className="text-white/40">Nenhuma sessão encontrada</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-5">
                {sessions.map((s) => (
                  <SessionCard key={s.id} session={s} videos={videos} onInvalidate={() => { invSessions(); inv(); }} />
                ))}
              </div>
            )}

            {/* Info */}
            <div className="card p-5">
              <h3 className="font-bold text-sm mb-3">💡 Como usar múltiplas lives</h3>
              <ul className="space-y-2.5">
                {[
                  "Crie uma sessão para cada canal do YouTube (ex: Canal Gaming, Canal Minecraft)",
                  "Cada sessão tem sua própria stream key — uma para cada canal",
                  "Todas as lives rodam ao mesmo tempo no servidor",
                  "Você pode pausar/retomar/parar cada live de forma independente",
                  "Quando parar uma live, pode deletar a sessão clicando no ✕",
                ].map((t, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="step-num w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <p className="text-xs text-white/40">{t}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ══════════════ TAB: IMPORT ══════════════ */}
        {tab === "import" && (
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="card p-5">
              <h2 className="font-bold mb-1">📥 Importar do YouTube</h2>
              <p className="text-xs text-white/30 mb-5">
                Cole a URL de um canal, playlist ou vídeo. Sem precisar de login Google.
              </p>

              <div className="space-y-4">
                {/* URL input */}
                <input type="url" value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)}
                  placeholder="https://www.youtube.com/@MeuCanal  ou  /@Canal/shorts"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-white/15 focus:outline-none" />
                <p className="text-[10px] text-white/20 -mt-2">
                  💡 Para buscar só Shorts: cole a URL do canal e adicione <span className="font-mono text-white/30">/shorts</span> no final
                </p>

                {/* Limit slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-white/40">Quantidade de vídeos</p>
                    <span className="text-sm font-bold accent-text">{importLimit}</span>
                  </div>
                  <input type="range" min={1} max={50} value={importLimit}
                    onChange={(e) => setImportLimit(Number(e.target.value))} className="w-full" />
                  <div className="flex justify-between text-[10px] text-white/20">
                    <span>1</span><span>50</span>
                  </div>
                </div>

                {/* Sort order */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-white/40">Ordenar por</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([["newest", "🆕 Mais recentes"], ["oldest", "📅 Mais antigos"]] as const).map(([v, label]) => (
                      <button key={v} onClick={() => setImportSort(v)}
                        className={`py-2 rounded-xl text-xs font-semibold transition-all ${importSort === v ? "accent-bg text-black" : "btn-ghost text-white/50"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={() => importListM.mutate({ data: { url: channelUrl, limit: importLimit, sort: importSort } })}
                  disabled={!channelUrl.trim() || importListM.isPending}
                  className="w-full py-3 rounded-xl font-bold text-sm text-black accent-bg disabled:opacity-30">
                  {importListM.isPending ? "Buscando vídeos…" : "🔍 Buscar vídeos"}
                </button>

                {importListM.isError && (
                  <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <p className="font-bold mb-1">❌ Erro ao buscar</p>
                    <p className="text-white/50">{(importListM.error as { data?: { error?: string } })?.data?.error ?? "Verifique a URL e aguarde o Railway recompilar com yt-dlp."}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Results */}
            {importListM.data && (
              <ImportResults
                data={importListM.data as { videos: Array<{ id: string; title: string; duration: number | null; thumbnail: string; url: string; isShort?: boolean }>; channelName: string | null }}
                downloadJobs={downloadJobs}
                onDownload={(v) => importDownloadM.mutate({ data: { url: v.url, title: v.title } })}
                isPending={importDownloadM.isPending}
                onDone={() => invVideos()}
              />
            )}

            {/* Active downloads */}
            {downloadJobs.length > 0 && (
              <div className="card p-5">
                <h3 className="font-bold text-sm mb-3">Downloads ativos</h3>
                <div className="space-y-3">
                  {downloadJobs.map((job) => (
                    <div key={job.jobId}>
                      <p className="text-xs text-white/50 mb-1 truncate">{job.title}</p>
                      <ImportProgressPoller jobId={job.jobId} onDone={() => invVideos()} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* How it works */}
            <div className="card p-5">
              <h3 className="font-bold text-sm mb-3">ℹ️ Como funciona</h3>
              <ul className="space-y-2.5">
                {[
                  "Cole a URL de um canal (@MeuCanal), playlist ou vídeo individual",
                  "Ajuste a quantidade (1–50) e a ordem (recentes ou antigos)",
                  "Clique em Buscar — o servidor lista os vídeos",
                  "Clique em Baixar nos vídeos desejados — barra de progresso em tempo real",
                  "Quando concluir, o vídeo aparece automaticamente na aba Stream",
                  "Funciona com canais públicos — sem precisar de login",
                ].map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="step-num w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <p className="text-xs text-white/40">{s}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                <p className="text-xs text-amber-400 font-semibold mb-1">⚠️ yt-dlp e o Railway</p>
                <p className="text-xs text-white/30">O yt-dlp é instalado via Dockerfile. Se o Railway ainda não recompilou após nossa última atualização, aguarde alguns minutos. O erro mostrará "yt-dlp não está disponível" se for esse o caso.</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/[0.04] py-6 text-center mt-8">
        <p className="text-xs text-white/15">LiveStream Loop · Para criadores do YouTube 🎥</p>
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
