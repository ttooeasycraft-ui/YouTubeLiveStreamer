import { Router } from "express";
import { spawn, execFile, type ChildProcess } from "child_process";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { StartStreamBody } from "@workspace/api-zod";

const router = Router();

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const THUMBNAILS_DIR = path.join(UPLOADS_DIR, "thumbnails");
if (!fs.existsSync(THUMBNAILS_DIR)) fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, "_");
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Formato não suportado. Use MP4, MOV, AVI, MKV, WEBM ou FLV."));
  },
});

const thumbStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, THUMBNAILS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `thumb_${Date.now()}${ext}`);
  },
});
const uploadThumb = multer({
  storage: thumbStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Use JPG, PNG ou WebP."));
  },
});

// ── Types ────────────────────────────────────────────────────────────────────

type StreamFormat = "landscape" | "shorts";
type LoopMode = "single" | "playlist";
type StreamPlatform = "youtube" | "tiktok" | "twitch" | "instagram";

interface Session {
  id: string;
  name: string;
  isStreaming: boolean;
  isPaused: boolean;
  videoFile: string | null;
  streamKey: string | null;
  format: StreamFormat;
  volume: number;
  startedAt: string | null;
  stableAt: string | null;
  stableTimer: ReturnType<typeof setTimeout> | null;
  pausedAt: string | null;
  error: string | null;
  ffmpegLog: string[];
  process: ChildProcess | null;
  playlist: string[];
  playlistIndex: number;
  loopMode: LoopMode;
  createdAt: string;
  platform: StreamPlatform;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), "stream-state.json");

interface PersistedSession {
  id: string;
  name: string;
  streamKey: string;
  videoFile: string;
  format: StreamFormat;
  volume: number;
  playlist: string[];
  platform: StreamPlatform;
  wasStable: boolean;
}

function saveState() {
  try {
    const active: PersistedSession[] = [];
    for (const s of sessions.values()) {
      if (s.isStreaming && !s.isPaused && s.streamKey && s.videoFile) {
        active.push({
          id: s.id, name: s.name,
          streamKey: s.streamKey, videoFile: s.videoFile,
          format: s.format, volume: s.volume,
          playlist: s.playlist, platform: s.platform,
          wasStable: s.stableAt !== null,
        });
      }
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify({ active, savedAt: new Date().toISOString() }, null, 2));
  } catch { /* non-fatal */ }
}

function clearState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ active: [], savedAt: new Date().toISOString() }, null, 2)); } catch { /* non-fatal */ }
}

interface DownloadJob {
  jobId: string;
  status: "downloading" | "done" | "error";
  percent: number;
  filename: string | null;
  error: string | null;
  title: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

const sessions = new Map<string, Session>();
const downloadJobs = new Map<string, DownloadJob>();

function createSession(id: string, name: string): Session {
  const s: Session = {
    id, name,
    isStreaming: false, isPaused: false,
    videoFile: null, streamKey: null,
    format: "landscape", volume: 100,
    startedAt: null, stableAt: null, stableTimer: null,
    pausedAt: null, error: null,
    ffmpegLog: [], process: null,
    playlist: [], playlistIndex: 0, loopMode: "single",
    createdAt: new Date().toISOString(),
    platform: "youtube",
  };
  sessions.set(id, s);
  return s;
}

// Default session always exists
const DEFAULT_ID = "default";
createSession(DEFAULT_ID, "Live Principal");

function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

function publicSession(s: Session) {
  const isStable = s.stableAt !== null;
  const stabilizingSince = !isStable && s.startedAt && s.isStreaming
    ? Math.max(0, 20 - Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000))
    : null;
  return {
    id: s.id,
    name: s.name,
    isStreaming: s.isStreaming,
    isPaused: s.isPaused,
    videoFile: s.videoFile,
    streamKey: s.streamKey ? s.streamKey.slice(0, 4) + "****" : null,
    format: s.format,
    volume: s.volume,
    startedAt: s.startedAt,
    stableAt: s.stableAt,
    isStable,
    stabilizingSecondsLeft: stabilizingSince,
    pausedAt: s.pausedAt,
    error: s.error,
    ffmpegLog: s.ffmpegLog.slice(-20),
    playlist: s.playlist,
    playlistIndex: s.playlistIndex,
    loopMode: s.loopMode,
    createdAt: s.createdAt,
    platform: s.platform,
  };
}

// ── RTMP URL builder ──────────────────────────────────────────────────────────

/**
 * Strip full RTMP URL if user accidentally pastes the entire stream URL.
 * e.g. "rtmp://a.rtmp.youtube.com/live2/xxxx-yyyy" → "xxxx-yyyy"
 */
function sanitizeStreamKey(raw: string): string {
  const s = raw.trim();
  const m = s.match(/rtmps?:\/\/[^/]+\/[^/]+\/(.+)/);
  return m ? m[1]!.trim() : s;
}

function buildRtmpUrl(platform: StreamPlatform, streamKey: string): string {
  const key = sanitizeStreamKey(streamKey);
  switch (platform) {
    case "tiktok":    return `rtmp://push.live-video.net/app/${key}`;
    case "twitch":    return `rtmp://live.twitch.tv/app/${key}`;
    case "instagram": return `rtmps://live-upload.instagram.com:443/rtmp/${key}`;
    case "youtube":
    default:          return `rtmp://a.rtmp.youtube.com/live2/${key}`;
  }
}

// ── FFmpeg helpers ────────────────────────────────────────────────────────────

function killProcess(proc: ChildProcess) {
  try { proc.kill("SIGTERM"); } catch { /* ignore */ }
  const t = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } }, 3000);
  proc.once("exit", () => clearTimeout(t));
}

function appendLog(s: Session, line: string) {
  const t = line.trim();
  if (!t) return;
  s.ffmpegLog.push(t);
  if (s.ffmpegLog.length > 100) s.ffmpegLog = s.ffmpegLog.slice(-100);
}

function buildFfmpegArgs(filePath: string, rtmpUrl: string, format: StreamFormat, volume: number, loop = true): string[] {
  const shortsFilter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1";
  const volFilter = volume !== 100 ? `volume=${(volume / 100).toFixed(2)}` : null;

  let filterArgs: string[] = [];
  if (format === "shorts" && volFilter) {
    filterArgs = ["-vf", shortsFilter, "-af", volFilter];
  } else if (format === "shorts") {
    filterArgs = ["-vf", shortsFilter];
  } else if (volFilter) {
    filterArgs = ["-af", volFilter];
  }

  return [
    "-re",
    ...(loop ? ["-stream_loop", "-1"] : []),
    "-i", filePath,
    ...filterArgs,
    "-c:v", "libx264", "-preset", "veryfast",
    "-maxrate", format === "shorts" ? "2500k" : "3000k",
    "-bufsize", format === "shorts" ? "5000k" : "6000k",
    "-pix_fmt", "yuv420p", "-g", "50",
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "44100",
    "-f", "flv", rtmpUrl,
  ];
}

function buildPauseArgs(rtmpUrl: string, format: StreamFormat): string[] {
  const w = format === "shorts" ? "1080" : "1920";
  const h = format === "shorts" ? "1920" : "1080";
  return [
    "-re",
    "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:r=30`,
    "-f", "lavfi", "-i", "aevalsrc=0:channel_layout=stereo:sample_rate=44100",
    "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "500k",
    "-c:a", "aac", "-b:a", "32k", "-shortest",
    "-f", "flv", rtmpUrl,
  ];
}

function spawnFfmpeg(s: Session, args: string[], onClose: (code: number | null) => void): ChildProcess {
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) appendLog(s, line);
  });
  proc.on("error", (err) => {
    s.isStreaming = false; s.isPaused = false; s.process = null;
    s.error = err.message === "spawn ffmpeg ENOENT" ? "FFmpeg não encontrado no servidor." : err.message;
  });
  proc.on("close", onClose);
  return proc;
}

function startVideoProcess(s: Session, filePath: string, rtmpUrl: string, isPlaylist: boolean) {
  const args = buildFfmpegArgs(filePath, rtmpUrl, s.format, s.volume, !isPlaylist);
  s.process = spawnFfmpeg(s, args, (code) => {
    if (s.isPaused || !s.isStreaming) return;

    if (isPlaylist && code === 0) {
      const next = s.playlistIndex + 1 < s.playlist.length ? s.playlistIndex + 1 : 0;
      s.playlistIndex = next;
      s.videoFile = s.playlist[next] ?? s.videoFile;
      s.process = null;
      const nextPath = path.join(UPLOADS_DIR, s.videoFile ?? "");
      if (s.videoFile && fs.existsSync(nextPath)) {
        startVideoProcess(s, nextPath, rtmpUrl, true);
      } else {
        s.isStreaming = false;
        s.error = `Arquivo não encontrado: ${s.videoFile}. Playlist interrompida.`;
      }
      return;
    }

    s.isStreaming = false; s.process = null;
    if (code !== 0) {
      const findLast = (lines: string[], pred: (l: string) => boolean): string | undefined => {
        for (let i = lines.length - 1; i >= 0; i--) if (pred(lines[i]!)) return lines[i];
        return undefined;
      };
      const rtmpErr = findLast(s.ffmpegLog, (l) =>
        l.includes("rtmp") || l.includes("Connection") || l.includes("Failed") || l.includes("error") || l.includes("Error"),
      );
      s.error = rtmpErr
        ? `Stream key inválida ou expirada: ${rtmpErr}`
        : `FFmpeg encerrou com código ${code}. Verifique a stream key.`;
    }
  });
}

function clearStableTimer(s: Session) {
  if (s.stableTimer) { clearTimeout(s.stableTimer); s.stableTimer = null; }
}

function doStart(s: Session, body: { streamKey: string; videoFile: string; format?: string; volume?: number; playlist?: string[]; platform?: string }): string | null {
  if (s.isStreaming) return "Já existe uma live ativa nesta sessão. Pare a atual antes de iniciar.";
  const filePath = path.join(UPLOADS_DIR, body.videoFile);
  if (!fs.existsSync(filePath)) return "Arquivo de vídeo não encontrado. Faça o upload primeiro.";

  const fmt = (body.format === "shorts" ? "shorts" : "landscape") as StreamFormat;
  const vol = Math.max(0, Math.min(100, Number(body.volume) || 100));
  const playlist = Array.isArray(body.playlist) && body.playlist.length > 1 ? body.playlist : [];
  const isPlaylist = playlist.length > 1;
  const platform = (["youtube","tiktok","twitch","instagram"].includes(body.platform ?? "") ? body.platform : "youtube") as StreamPlatform;
  const rtmpUrl = buildRtmpUrl(platform, body.streamKey);

  clearStableTimer(s);
  s.isStreaming = true; s.isPaused = false;
  s.videoFile = body.videoFile; s.streamKey = body.streamKey;
  s.format = fmt; s.volume = vol; s.platform = platform;
  s.startedAt = new Date().toISOString(); s.stableAt = null; s.pausedAt = null; s.error = null; s.ffmpegLog = [];
  s.loopMode = isPlaylist ? "playlist" : "single";
  s.playlist = isPlaylist ? playlist : [];
  s.playlistIndex = isPlaylist ? Math.max(0, playlist.indexOf(body.videoFile)) : 0;

  startVideoProcess(s, filePath, rtmpUrl, isPlaylist);

  // Mark stable after 20 seconds of continuous streaming
  s.stableTimer = setTimeout(() => {
    if (s.isStreaming && !s.isPaused) {
      s.stableAt = new Date().toISOString();
      saveState();
    }
    s.stableTimer = null;
  }, 20000);

  return null;
}

function doStop(s: Session): string | null {
  if (!s.isStreaming || !s.process) return "Nenhuma live ativa nesta sessão.";
  const proc = s.process;
  clearStableTimer(s);
  s.isStreaming = false; s.isPaused = false; s.process = null; s.error = null; s.pausedAt = null;
  s.stableAt = null;
  s.playlist = []; s.playlistIndex = 0; s.loopMode = "single";
  killProcess(proc);
  saveState();
  return null;
}

function doPause(s: Session): string | null {
  if (!s.isStreaming || !s.process) return "Nenhuma live ativa.";
  if (s.isPaused) return "Live já está pausada.";
  const proc = s.process;
  clearStableTimer(s);
  s.isPaused = true; s.pausedAt = new Date().toISOString(); s.process = null;
  killProcess(proc);
  const rtmpUrl = buildRtmpUrl(s.platform, s.streamKey!);
  s.process = spawnFfmpeg(s, buildPauseArgs(rtmpUrl, s.format), (code) => {
    if (!s.isPaused) return;
    s.isStreaming = false; s.isPaused = false; s.process = null;
    if (code !== 0) s.error = "Conexão pausada perdida. Reinicie a live.";
    saveState();
  });
  saveState();
  return null;
}

function doResume(s: Session): string | null {
  if (!s.isStreaming || !s.isPaused) return "Nenhuma live pausada.";
  const proc = s.process;
  s.isPaused = false; s.pausedAt = null; s.stableAt = null; s.process = null;
  if (proc) killProcess(proc);
  const filePath = path.join(UPLOADS_DIR, s.videoFile ?? "");
  if (!s.videoFile || !fs.existsSync(filePath)) {
    s.isStreaming = false; s.error = "Arquivo de vídeo não encontrado. Faça upload novamente.";
    return s.error;
  }
  const rtmpUrl = buildRtmpUrl(s.platform, s.streamKey!);
  startVideoProcess(s, filePath, rtmpUrl, s.loopMode === "playlist");
  // Restart stability timer after resume
  s.stableTimer = setTimeout(() => {
    if (s.isStreaming && !s.isPaused) { s.stableAt = new Date().toISOString(); saveState(); }
    s.stableTimer = null;
  }, 20000);
  return null;
}

function doVolume(s: Session, vol: number): string | null {
  if (!s.isStreaming) return "Nenhuma live ativa.";
  s.volume = vol;
  if (s.isPaused) return null;
  const proc = s.process; s.process = null;
  if (proc) killProcess(proc);
  const filePath = path.join(UPLOADS_DIR, s.videoFile ?? "");
  if (!s.videoFile || !fs.existsSync(filePath)) {
    s.isStreaming = false; s.error = "Arquivo não encontrado.";
    return s.error;
  }
  const rtmpUrl = buildRtmpUrl(s.platform, s.streamKey!);
  startVideoProcess(s, filePath, rtmpUrl, s.loopMode === "playlist");
  return null;
}

function doSwitchVideo(s: Session, videoFile: string): string | null {
  if (!s.isStreaming) return "Nenhuma live ativa.";
  const filePath = path.join(UPLOADS_DIR, videoFile);
  if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) return "Arquivo não encontrado.";
  const proc = s.process; s.process = null; s.videoFile = videoFile;
  const rtmpUrl = buildRtmpUrl(s.platform, s.streamKey!);
  if (s.isPaused) {
    if (proc) killProcess(proc);
    s.process = spawnFfmpeg(s, buildPauseArgs(rtmpUrl, s.format), (code) => {
      if (!s.isPaused) return;
      s.isStreaming = false; s.isPaused = false; s.process = null;
      if (code !== 0) s.error = "Conexão pausada perdida.";
    });
    return null;
  }
  if (proc) killProcess(proc);
  startVideoProcess(s, filePath, rtmpUrl, s.loopMode === "playlist");
  return null;
}

// ── Auto-restore ──────────────────────────────────────────────────────────────

function autoRestoreState() {
  if (!fs.existsSync(STATE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as { active?: PersistedSession[] };
    if (!Array.isArray(raw.active) || raw.active.length === 0) return;
    // Delay 3 seconds to let server fully initialize
    setTimeout(() => {
      for (const p of raw.active!) {
        const videoPath = path.join(UPLOADS_DIR, p.videoFile);
        if (!fs.existsSync(videoPath)) continue;
        let s = sessions.get(p.id);
        if (!s) s = createSession(p.id, p.name || "Sessão Restaurada");
        if (s.isStreaming) continue;
        const err = doStart(s, {
          streamKey: p.streamKey, videoFile: p.videoFile,
          format: p.format, volume: p.volume,
          playlist: p.playlist, platform: p.platform,
        });
        if (err) {
          console.error(`[autoRestore] Sessão ${p.id}: ${err}`);
        } else {
          if (p.wasStable) {
            // Session was already stable before restart (e.g. server redeploy) —
            // it's a reconnect, not a fresh stream, so skip the 20s wait.
            clearStableTimer(s);
            s.stableAt = new Date().toISOString();
            saveState();
          }
          console.log(`[autoRestore] Sessão ${p.id} (${p.name}) restaurada com sucesso.`);
        }
      }
    }, 3000);
  } catch (e) {
    console.error("[autoRestore] Erro ao ler state file:", e);
  }
}

// Run on module load
autoRestoreState();

// ── Meta helpers ──────────────────────────────────────────────────────────────

function readMeta(): Record<string, { originalName: string; uploadedAt: string }> {
  const p = path.join(UPLOADS_DIR, "meta.json");
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return {}; }
}

function saveMeta(filename: string, originalName: string) {
  const p = path.join(UPLOADS_DIR, "meta.json");
  const meta = readMeta();
  meta[filename] = { originalName, uploadedAt: new Date().toISOString() };
  fs.writeFileSync(p, JSON.stringify(meta, null, 2));
}

// ── yt-dlp helpers ────────────────────────────────────────────────────────────

function cleanYtUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const keep = ["list", "v", "index"];
    const params = new URLSearchParams();
    for (const k of keep) { const v = u.searchParams.get(k); if (v) params.set(k, v); }
    const qs = params.toString();
    return `${u.origin}${u.pathname}${qs ? "?" + qs : ""}`;
  } catch {
    return raw.trim();
  }
}

// For LISTING: bare @handle channel URL → /videos tab so yt-dlp returns individual videos
// instead of the channel's tab-playlists (Vídeos/Live/Shorts sections).
// If the caller already passed /@handle/shorts, keep it as-is so we list Shorts.
function normalizeListUrl(raw: string): string {
  const clean = cleanYtUrl(raw);
  const isBarechannel = /^https?:\/\/(?:www\.)?youtube\.com\/@[^/?#]+\/?$/.test(clean);
  if (isBarechannel) {
    return clean.replace(/\/?$/, "") + "/videos";
  }
  return clean;
}

/** True when a yt-dlp flat-playlist entry is a YouTube Short (≤60s or /shorts/ in url) */
function isShortEntry(e: Record<string, unknown>): boolean {
  const dur = typeof e.duration === "number" ? e.duration : null;
  const url = String(e.url ?? e.webpage_url ?? "");
  return url.includes("/shorts/") || (dur !== null && dur <= 61);
}

function ytDlpAvailable(): Promise<boolean> {
  return new Promise((resolve) => execFile("yt-dlp", ["--version"], { timeout: 5000 }, (err) => resolve(!err)));
}

// ── yt-dlp cookies & anti-bot args ───────────────────────────────────────────

const COOKIES_DIR = path.join(process.cwd(), ".ytdlp");
const COOKIES_FILE = path.join(COOKIES_DIR, "cookies.txt");

/** Write YTDLP_COOKIES env-var content to disk once on first call. */
function ensureCookiesFile(): void {
  const content = process.env.YTDLP_COOKIES?.trim();
  if (!content) return;
  try {
    if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });
    // Only rewrite if content changed (avoid thrashing on every request)
    const existing = fs.existsSync(COOKIES_FILE) ? fs.readFileSync(COOKIES_FILE, "utf8").trim() : "";
    if (existing !== content) fs.writeFileSync(COOKIES_FILE, content + "\n", { mode: 0o600 });
  } catch {
    // Non-fatal — continue without cookies file
  }
}

/**
 * Returns extra yt-dlp args that bypass bot detection.
 * - cookies.txt if YTDLP_COOKIES env var is set
 * - android player_client (avoids sign-in gate on most public videos)
 */
function ytDlpAntiBot(): string[] {
  ensureCookiesFile();
  const args: string[] = [
    "--extractor-args", "youtube:player_client=android",
  ];
  if (process.env.YTDLP_COOKIES?.trim() && fs.existsSync(COOKIES_FILE)) {
    args.push("--cookies", COOKIES_FILE);
  }
  return args;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// ── Videos ──────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv"]);

router.get("/videos", (_req, res) => {
  if (!fs.existsSync(UPLOADS_DIR)) { res.json([]); return; }
  const meta = readMeta();
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter((f) => {
      if (f === "meta.json") return false;
      const full = path.join(UPLOADS_DIR, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) return false; // skip thumbnails/ and any other subdirs
      if (!VIDEO_EXTS.has(path.extname(f).toLowerCase())) return false;
      return true;
    })
    .map((filename) => {
      const stat = fs.statSync(path.join(UPLOADS_DIR, filename));
      const info = meta[filename];
      return { filename, originalName: info?.originalName ?? filename, size: stat.size, uploadedAt: info?.uploadedAt ?? stat.birthtime.toISOString() };
    });
  res.json(files);
});

router.delete("/videos/:filename", (req, res) => {
  const { filename } = req.params;
  if (!filename || filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Nome de arquivo inválido." }); return;
  }
  const inUse = Array.from(sessions.values()).some((s) => s.isStreaming && s.videoFile === filename);
  if (inUse) { res.status(409).json({ error: "Não é possível deletar o vídeo enquanto está em uso em uma live." }); return; }
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Arquivo não encontrado." }); return; }
  fs.unlinkSync(filePath);
  const meta = readMeta(); delete meta[filename];
  fs.writeFileSync(path.join(UPLOADS_DIR, "meta.json"), JSON.stringify(meta, null, 2));
  res.json({ deleted: filename });
});

router.post("/upload", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err) { res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "Nenhum arquivo enviado." }); return; }
    saveMeta(req.file.filename, req.file.originalname);
    res.json({ filename: req.file.filename, originalName: req.file.originalname, size: req.file.size });
  });
});

// ── Legacy single-stream endpoints (default session) ─────────────────────────

router.get("/status", (_req, res) => {
  const s = getSession(DEFAULT_ID)!;
  res.json(publicSession(s));
});

router.post("/start", (req, res) => {
  const s = getSession(DEFAULT_ID)!;
  const parsed = StartStreamBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "streamKey e videoFile são obrigatórios." }); return; }
  const err = doStart(s, { ...parsed.data, playlist: req.body.playlist });
  if (err) { res.status(409).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/stop", (_req, res) => {
  const s = getSession(DEFAULT_ID)!;
  const err = doStop(s);
  if (err) { res.status(404).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/pause", (_req, res) => {
  const s = getSession(DEFAULT_ID)!;
  const err = doPause(s);
  if (err) { res.status(err.includes("já está") ? 409 : 404).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/resume", (_req, res) => {
  const s = getSession(DEFAULT_ID)!;
  const err = doResume(s);
  if (err) { res.status(400).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/volume", (req, res) => {
  const s = getSession(DEFAULT_ID)!;
  const vol = Number(req.body?.volume);
  if (!Number.isInteger(vol) || vol < 0 || vol > 100) {
    res.status(400).json({ error: "Volume deve ser 0-100." }); return;
  }
  const err = doVolume(s, vol);
  if (err) { res.status(404).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/switch-video", (req, res) => {
  const s = getSession(DEFAULT_ID)!;
  const { videoFile } = req.body as { videoFile?: string };
  if (!videoFile) { res.status(400).json({ error: "videoFile é obrigatório." }); return; }
  const err = doSwitchVideo(s, videoFile);
  if (err) { res.status(400).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/playlist", (req, res) => {
  const s = getSession(DEFAULT_ID)!;
  const { playlist } = req.body as { playlist?: string[] };
  if (!Array.isArray(playlist)) { res.status(400).json({ error: "playlist deve ser um array." }); return; }
  s.playlist = playlist;
  s.loopMode = playlist.length > 1 ? "playlist" : "single";
  if (s.isStreaming && s.videoFile) {
    const idx = playlist.indexOf(s.videoFile);
    s.playlistIndex = idx >= 0 ? idx : 0;
  }
  res.json(publicSession(s));
});

// ── Multi-session endpoints ───────────────────────────────────────────────────

router.get("/sessions", (_req, res) => {
  res.json(Array.from(sessions.values()).map(publicSession));
});

router.post("/sessions", (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name é obrigatório." }); return;
  }
  const id = crypto.randomUUID();
  const s = createSession(id, name.trim().slice(0, 60));
  res.json(publicSession(s));
});

router.get("/sessions/:sessionId", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  res.json(publicSession(s));
});

router.delete("/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (sessionId === DEFAULT_ID) { res.status(409).json({ error: "A sessão principal não pode ser deletada." }); return; }
  const s = getSession(sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  if (s.isStreaming) { res.status(409).json({ error: "Pare a live antes de deletar a sessão." }); return; }
  if (s.process) killProcess(s.process);
  sessions.delete(sessionId);
  res.json({ deleted: sessionId });
});

router.patch("/sessions/:sessionId", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) { res.status(400).json({ error: "name é obrigatório." }); return; }
  s.name = name.trim().slice(0, 60);
  res.json(publicSession(s));
});

router.post("/sessions/:sessionId/start", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  const parsed = StartStreamBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "streamKey e videoFile são obrigatórios." }); return; }
  const err = doStart(s, { ...parsed.data, playlist: req.body.playlist });
  if (err) { res.status(err.includes("Já existe") ? 409 : 400).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/sessions/:sessionId/stop", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  const err = doStop(s);
  if (err) { res.status(404).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/sessions/:sessionId/pause", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  const err = doPause(s);
  if (err) { res.status(err.includes("já está") ? 409 : 404).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/sessions/:sessionId/resume", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  const err = doResume(s);
  if (err) { res.status(400).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/sessions/:sessionId/volume", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  const vol = Number(req.body?.volume);
  if (!Number.isInteger(vol) || vol < 0 || vol > 100) {
    res.status(400).json({ error: "Volume deve ser 0-100." }); return;
  }
  const err = doVolume(s, vol);
  if (err) { res.status(404).json({ error: err }); return; }
  res.json(publicSession(s));
});

router.post("/sessions/:sessionId/switch-video", (req, res) => {
  const s = getSession(req.params.sessionId);
  if (!s) { res.status(404).json({ error: "Sessão não encontrada." }); return; }
  const { videoFile } = req.body as { videoFile?: string };
  if (!videoFile) { res.status(400).json({ error: "videoFile é obrigatório." }); return; }
  const err = doSwitchVideo(s, videoFile);
  if (err) { res.status(400).json({ error: err }); return; }
  res.json(publicSession(s));
});

// ── Import (yt-dlp) ───────────────────────────────────────────────────────────

router.post("/import/list", async (req, res) => {
  if (!await ytDlpAvailable()) {
    res.status(503).json({ error: "yt-dlp não está disponível neste servidor. Aguarde o Railway recompilar o backend com a nova versão do Dockerfile." }); return;
  }

  const { url, limit = 20, sort = "newest" } = req.body as { url?: string; limit?: number; sort?: string };
  if (!url) { res.status(400).json({ error: "url é obrigatório." }); return; }
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    res.status(400).json({ error: "Use uma URL do YouTube (canal, playlist ou vídeo)." }); return;
  }

  // Use normalizeListUrl so bare @channel → @channel/videos (avoids returning tabs instead of videos)
  const cleanUrl = normalizeListUrl(url);
  const clampedLimit = Math.max(1, Math.min(50, Number(limit) || 20));

  const args = [
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    "--playlist-end", String(clampedLimit),
    ...(sort === "oldest" ? ["--playlist-reverse"] : []),
    ...ytDlpAntiBot(),
    cleanUrl,
  ];

  execFile("yt-dlp", args, { timeout: 45000 }, (err, stdout, stderr) => {
    if (err) {
      const msg = (stderr || err.message).trim();
      // Extract most useful part of error
      const lines = msg.split("\n").filter((l) => l.includes("ERROR") || l.includes("error") || l.includes("Unable") || l.includes("not found"));
      const friendly = lines[0] ?? msg.slice(0, 300);
      res.status(400).json({ error: `Não foi possível acessar este canal/playlist: ${friendly}` }); return;
    }

    try {
      const data = JSON.parse(stdout.trim());
      const entries = Array.isArray(data.entries) ? data.entries : (data.id ? [data] : []);
      const channelName: string | null = data.channel ?? data.uploader ?? data.title ?? null;

      const videos = entries
        .filter((e: Record<string, unknown>) => {
          if (!e.id) return false;
          // Skip entries that are playlists/tabs (channel structure returns tabs as playlist entries)
          // _type === "playlist" or ie_key === "YoutubeTab" means it's a tab, not a video
          if (e._type === "playlist") return false;
          if (typeof e.ie_key === "string" && e.ie_key === "YoutubeTab") return false;
          // If the url is a playlist url (/playlist?list=) without a watch?v= or /shorts/, skip it
          const eUrl = String(e.url ?? e.webpage_url ?? "");
          if (eUrl.includes("/playlist?list=") || (eUrl.includes("/@") && !eUrl.includes("/watch?v=") && !eUrl.includes("/shorts/"))) return false;
          return true;
        })
        .map((e: Record<string, unknown>) => {
          const thumbnails = Array.isArray(e.thumbnails) ? e.thumbnails : [];
          const thumb = thumbnails.length > 0 ? (thumbnails[thumbnails.length - 1] as { url?: string })?.url : null;
          const videoId = String(e.id);
          const short = isShortEntry(e);
          // Build best video URL — Shorts get /shorts/ canonical link; videos get watch?v=
          const videoUrl = short
            ? (typeof e.webpage_url === "string" && e.webpage_url.includes("/shorts/")
              ? e.webpage_url
              : typeof e.url === "string" && e.url.includes("/shorts/")
              ? e.url
              : `https://www.youtube.com/shorts/${videoId}`)
            : (typeof e.webpage_url === "string" && e.webpage_url.includes("watch?v=")
              ? e.webpage_url
              : typeof e.url === "string" && e.url.includes("watch?v=")
              ? e.url
              : `https://www.youtube.com/watch?v=${videoId}`);
          return {
            id: videoId,
            title: typeof e.title === "string" ? e.title : "(sem título)",
            duration: typeof e.duration === "number" ? e.duration : null,
            thumbnail: thumb ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            url: videoUrl,
            isShort: short,
          };
        });

      res.json({ videos, channelName });
    } catch (parseErr) {
      res.status(400).json({ error: "Não foi possível interpretar a resposta do yt-dlp. Tente outra URL." });
    }
  });
});

router.post("/import/download", async (req, res) => {
  if (!await ytDlpAvailable()) {
    res.status(503).json({ error: "yt-dlp não está disponível neste servidor." }); return;
  }

  const { url, title } = req.body as { url?: string; title?: string };
  if (!url) { res.status(400).json({ error: "url é obrigatório." }); return; }
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    res.status(400).json({ error: "Use uma URL do YouTube." }); return;
  }

  const jobId = crypto.randomUUID();
  const safeTitle = (title ?? "video").replace(/[^a-z0-9]/gi, "_").slice(0, 60);
  const outputTemplate = path.join(UPLOADS_DIR, `${safeTitle}_${Date.now()}.%(ext)s`);

  const job: DownloadJob = { jobId, status: "downloading", percent: 0, filename: null, error: null, title: title ?? "Vídeo" };
  downloadJobs.set(jobId, job);

  const videoUrl = cleanYtUrl(url);

  // Allow watch?v=, youtu.be/, and /shorts/ — block channel/playlist URLs
  const isVideoUrl = videoUrl.includes("/watch?v=") || videoUrl.includes("youtu.be/") || videoUrl.includes("/shorts/");
  if (!isVideoUrl) {
    if (videoUrl.includes("/playlist?list=") || videoUrl.includes("/@") || videoUrl.includes("/channel/")) {
      res.status(400).json({ error: "Esta URL é de um canal/playlist, não de um vídeo. Use a aba Importar para buscar e selecionar vídeos individuais." });
      return;
    }
  }

  const proc = spawn("yt-dlp", [
    "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--output", outputTemplate,
    "--no-playlist",
    "--newline",
    "--no-warnings",
    ...ytDlpAntiBot(),
    videoUrl,
  ]);

  const parseProgress = (text: string) => {
    const m = text.match(/\[download\]\s+([\d.]+)%/);
    if (m) job.percent = parseFloat(m[1]!);
    const dest = text.match(/\[(?:download|Merger|ExtractAudio)\] Destination:\s*(.+)/);
    if (dest) job.filename = path.basename(dest[1]!.trim());
  };

  proc.stdout.on("data", (c: Buffer) => parseProgress(c.toString()));
  proc.stderr.on("data", (c: Buffer) => parseProgress(c.toString()));

  proc.on("close", (code) => {
    if (code === 0) {
      job.status = "done"; job.percent = 100;
      if (!job.filename) {
        const prefix = path.basename(outputTemplate).replace(".%(ext)s", "");
        const found = fs.readdirSync(UPLOADS_DIR).find((f) => f.startsWith(prefix.split("_").slice(0, -1).join("_")));
        if (found) job.filename = found;
      }
      if (job.filename) saveMeta(job.filename, title ?? job.filename);
    } else {
      job.status = "error"; job.error = `yt-dlp encerrou com código ${code}`;
    }
  });
  proc.on("error", (err) => { job.status = "error"; job.error = err.message; });

  res.json({ jobId, title: job.title });
});

router.get("/import/progress/:jobId", (req, res) => {
  const job = downloadJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job não encontrado." }); return; }
  res.json({ jobId: job.jobId, status: job.status, percent: job.percent, filename: job.filename, error: job.error });
});

// ── Thumbnail ─────────────────────────────────────────────────────────────────

router.post("/thumbnail", (req, res) => {
  uploadThumb.single("thumbnail")(req, res, (err) => {
    if (err) { res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "Nenhuma imagem enviada." }); return; }
    res.json({ filename: req.file.filename });
  });
});

router.get("/thumbnail/view/:filename", (req, res) => {
  const { filename } = req.params;
  if (!filename || filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Nome inválido." }); return;
  }
  const fp = path.join(THUMBNAILS_DIR, filename);
  if (!fs.existsSync(fp)) { res.status(404).json({ error: "Thumbnail não encontrada." }); return; }
  const ext = path.extname(fp).toLowerCase();
  const mime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
  res.setHeader("Content-Type", mime[ext] ?? "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(fp);
});

export default router;
