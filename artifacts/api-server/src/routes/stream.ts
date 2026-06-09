import { Router } from "express";
import { spawn, execFile, type ChildProcess } from "child_process";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { StartStreamBody } from "@workspace/api-zod";

const router = Router();

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Formato não suportado. Use MP4, MOV, AVI, MKV, WEBM ou FLV."));
  },
});

type StreamFormat = "landscape" | "shorts";
type LoopMode = "single" | "playlist";

interface StreamState {
  isStreaming: boolean;
  isPaused: boolean;
  videoFile: string | null;
  streamKey: string | null;
  format: StreamFormat;
  volume: number;
  startedAt: string | null;
  pausedAt: string | null;
  error: string | null;
  ffmpegLog: string[];
  process: ChildProcess | null;
  // playlist
  playlist: string[];
  playlistIndex: number;
  loopMode: LoopMode;
}

const state: StreamState = {
  isStreaming: false,
  isPaused: false,
  videoFile: null,
  streamKey: null,
  format: "landscape",
  volume: 100,
  startedAt: null,
  pausedAt: null,
  error: null,
  ffmpegLog: [],
  process: null,
  playlist: [],
  playlistIndex: 0,
  loopMode: "single",
};

// ── Download jobs (yt-dlp) ───────────────────────────────────────────────────
interface DownloadJob {
  jobId: string;
  status: "downloading" | "done" | "error";
  percent: number;
  filename: string | null;
  error: string | null;
  title: string;
}
const downloadJobs = new Map<string, DownloadJob>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPublicState() {
  return {
    isStreaming: state.isStreaming,
    isPaused: state.isPaused,
    videoFile: state.videoFile,
    streamKey: state.streamKey ? state.streamKey.slice(0, 4) + "****" : null,
    format: state.format,
    volume: state.volume,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    error: state.error,
    ffmpegLog: state.ffmpegLog.slice(-20),
    playlist: state.playlist,
    playlistIndex: state.playlistIndex,
    loopMode: state.loopMode,
  };
}

function killProcess(proc: ChildProcess) {
  try { proc.kill("SIGTERM"); } catch { /* ignore */ }
  const timer = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
  }, 3000);
  proc.once("exit", () => clearTimeout(timer));
}

function buildFfmpegArgs(
  filePath: string,
  rtmpUrl: string,
  format: StreamFormat,
  volume: number,
  loopSingle = true,
): string[] {
  const volumeFilter = volume === 100 ? [] : ["-af", `volume=${(volume / 100).toFixed(2)}`];
  const shortsFilter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1";
  const videoFilter = format === "shorts" ? ["-vf", shortsFilter] : [];

  let filters: string[] = [];
  if (format === "shorts" && volume !== 100) {
    filters = ["-vf", shortsFilter, "-af", `volume=${(volume / 100).toFixed(2)}`];
  } else {
    filters = [...videoFilter, ...volumeFilter];
  }

  const loopArgs = loopSingle ? ["-stream_loop", "-1"] : [];

  return [
    "-re",
    ...loopArgs,
    "-i", filePath,
    ...filters,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-maxrate", format === "shorts" ? "2500k" : "3000k",
    "-bufsize", format === "shorts" ? "5000k" : "6000k",
    "-pix_fmt", "yuv420p",
    "-g", "50",
    "-c:a", "aac",
    "-b:a", "160k",
    "-ac", "2",
    "-ar", "44100",
    "-f", "flv",
    rtmpUrl,
  ];
}

function buildPauseArgs(rtmpUrl: string, format: StreamFormat): string[] {
  const w = format === "shorts" ? "1080" : "1920";
  const h = format === "shorts" ? "1920" : "1080";
  return [
    "-re",
    "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:r=30`,
    "-f", "lavfi", "-i", "aevalsrc=0:channel_layout=stereo:sample_rate=44100",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-b:v", "500k",
    "-c:a", "aac",
    "-b:a", "32k",
    "-shortest",
    "-f", "flv",
    rtmpUrl,
  ];
}

function appendLog(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;
  state.ffmpegLog.push(trimmed);
  if (state.ffmpegLog.length > 100) state.ffmpegLog = state.ffmpegLog.slice(-100);
}

function spawnFfmpeg(args: string[], onClose: (code: number | null) => void): ChildProcess {
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

  proc.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) appendLog(line);
  });

  proc.on("error", (err) => {
    state.isStreaming = false;
    state.isPaused = false;
    state.error = err.message === "spawn ffmpeg ENOENT"
      ? "FFmpeg não encontrado no servidor."
      : err.message;
    state.process = null;
  });

  proc.on("close", onClose);
  return proc;
}

/** Starts FFmpeg for a single video. In playlist mode, advances on code=0. */
function startVideoProcess(
  filePath: string,
  rtmpUrl: string,
  format: StreamFormat,
  volume: number,
  isPlaylistMode: boolean,
) {
  // In playlist mode each video plays once (no loop), in single mode loop forever
  const args = buildFfmpegArgs(filePath, rtmpUrl, format, volume, !isPlaylistMode);

  state.process = spawnFfmpeg(args, (code) => {
    if (state.isPaused) return;
    if (!state.isStreaming) return;

    if (isPlaylistMode && code === 0) {
      // Advance to next in playlist
      const nextIndex = state.playlistIndex + 1;
      if (nextIndex < state.playlist.length) {
        state.playlistIndex = nextIndex;
        const nextFile = state.playlist[nextIndex]!;
        state.videoFile = nextFile;
        state.process = null;
        const nextPath = path.join(UPLOADS_DIR, nextFile);
        if (fs.existsSync(nextPath)) {
          startVideoProcess(nextPath, rtmpUrl, format, volume, true);
        } else {
          state.error = `Arquivo não encontrado: ${nextFile}. Playlist interrompida.`;
          state.isStreaming = false;
          state.process = null;
        }
      } else {
        // End of playlist — loop back to start
        state.playlistIndex = 0;
        const firstFile = state.playlist[0]!;
        state.videoFile = firstFile;
        state.process = null;
        const firstPath = path.join(UPLOADS_DIR, firstFile);
        if (fs.existsSync(firstPath)) {
          startVideoProcess(firstPath, rtmpUrl, format, volume, true);
        } else {
          state.isStreaming = false;
          state.error = "Playlist finalizada — arquivo inicial não encontrado.";
        }
      }
      return;
    }

    // Non-zero exit or single mode finished
    state.isStreaming = false;
    state.process = null;
    if (code !== 0) {
      const findLast = (lines: string[], pred: (l: string) => boolean): string | undefined => {
        for (let i = lines.length - 1; i >= 0; i--) if (pred(lines[i]!)) return lines[i];
        return undefined;
      };
      const rtmpError = findLast(
        state.ffmpegLog,
        (l) => l.includes("rtmp") || l.includes("Connection") || l.includes("Failed") || l.includes("error") || l.includes("Error"),
      );
      state.error = rtmpError
        ? `Stream key inválida ou expirada: ${rtmpError}`
        : `FFmpeg encerrou com código ${code}. Verifique a stream key.`;
    }
  });
}

function saveMeta(filename: string, originalName: string) {
  const metaPath = path.join(UPLOADS_DIR, "meta.json");
  let meta: Record<string, { originalName: string; uploadedAt: string }> = {};
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch { /* ignore */ }
  }
  meta[filename] = { originalName, uploadedAt: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

function readMeta(): Record<string, { originalName: string; uploadedAt: string }> {
  const metaPath = path.join(UPLOADS_DIR, "meta.json");
  if (!fs.existsSync(metaPath)) return {};
  try { return JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch { return {}; }
}

function ytDlpAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("yt-dlp", ["--version"], (err) => resolve(!err));
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/status", (_req, res) => {
  res.json(getPublicState());
});

// ── Videos ──────────────────────────────────────────────────────────────────

router.get("/videos", (_req, res) => {
  if (!fs.existsSync(UPLOADS_DIR)) { res.json([]); return; }
  const meta = readMeta();
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter((f) => f !== "meta.json")
    .map((filename) => {
      const stat = fs.statSync(path.join(UPLOADS_DIR, filename));
      const info = meta[filename];
      return {
        filename,
        originalName: info?.originalName ?? filename,
        size: stat.size,
        uploadedAt: info?.uploadedAt ?? stat.birthtime.toISOString(),
      };
    });
  res.json(files);
});

router.delete("/videos/:filename", (req, res) => {
  const { filename } = req.params;
  if (!filename || filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Nome de arquivo inválido." }); return;
  }
  if (state.isStreaming && state.videoFile === filename) {
    res.status(409).json({ error: "Não é possível deletar o vídeo enquanto a live está ativa." }); return;
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Arquivo não encontrado." }); return; }
  fs.unlinkSync(filePath);
  const meta = readMeta();
  delete meta[filename];
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

// ── Stream control ───────────────────────────────────────────────────────────

router.post("/start", (req, res) => {
  if (state.isStreaming) {
    res.status(409).json({ error: "Já existe uma live ativa. Pare a atual antes de iniciar uma nova." }); return;
  }
  const parsed = StartStreamBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "streamKey e videoFile são obrigatórios." }); return; }

  const { streamKey, videoFile, format = "landscape", volume = 100 } = parsed.data;
  const playlist: string[] = Array.isArray(req.body.playlist) ? req.body.playlist : [];

  const filePath = path.join(UPLOADS_DIR, videoFile);
  if (!fs.existsSync(filePath)) {
    res.status(400).json({ error: "Arquivo de vídeo não encontrado. Faça o upload primeiro." }); return;
  }

  const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${streamKey}`;
  const fmt = (format === "shorts" ? "shorts" : "landscape") as StreamFormat;
  const vol = Math.max(0, Math.min(100, Number(volume) || 100));
  const hasPlaylist = playlist.length > 1;

  state.isStreaming = true;
  state.isPaused = false;
  state.videoFile = videoFile;
  state.streamKey = streamKey;
  state.format = fmt;
  state.volume = vol;
  state.startedAt = new Date().toISOString();
  state.pausedAt = null;
  state.error = null;
  state.ffmpegLog = [];
  state.loopMode = hasPlaylist ? "playlist" : "single";
  state.playlist = hasPlaylist ? playlist : [];
  state.playlistIndex = hasPlaylist ? playlist.indexOf(videoFile) : 0;
  if (state.playlistIndex < 0) state.playlistIndex = 0;

  startVideoProcess(filePath, rtmpUrl, fmt, vol, hasPlaylist);
  res.json(getPublicState());
});

router.post("/stop", (_req, res) => {
  if (!state.isStreaming || !state.process) {
    res.status(404).json({ error: "Nenhuma live ativa no momento." }); return;
  }
  const proc = state.process;
  state.isStreaming = false;
  state.isPaused = false;
  state.process = null;
  state.error = null;
  state.pausedAt = null;
  state.playlist = [];
  state.playlistIndex = 0;
  state.loopMode = "single";
  killProcess(proc);
  res.json(getPublicState());
});

router.post("/pause", (_req, res) => {
  if (!state.isStreaming || !state.process) {
    res.status(404).json({ error: "Nenhuma live ativa." }); return;
  }
  if (state.isPaused) {
    res.status(409).json({ error: "Live já está pausada." }); return;
  }

  const proc = state.process;
  state.isPaused = true;
  state.pausedAt = new Date().toISOString();
  state.process = null;

  killProcess(proc);

  const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${state.streamKey}`;
  state.process = spawnFfmpeg(buildPauseArgs(rtmpUrl, state.format), (code) => {
    if (!state.isPaused) return;
    state.isStreaming = false;
    state.isPaused = false;
    state.process = null;
    if (code !== 0) state.error = "Conexão pausada perdida. Reinicie a live.";
  });

  res.json(getPublicState());
});

router.post("/resume", (_req, res) => {
  if (!state.isStreaming || !state.isPaused) {
    res.status(404).json({ error: "Nenhuma live pausada para retomar." }); return;
  }

  const proc = state.process;
  state.isPaused = false;
  state.pausedAt = null;
  state.process = null;

  if (proc) killProcess(proc);

  const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${state.streamKey}`;
  const filePath = path.join(UPLOADS_DIR, state.videoFile!);

  if (!fs.existsSync(filePath)) {
    state.isStreaming = false;
    state.error = "Arquivo de vídeo não encontrado. Faça upload novamente.";
    res.status(400).json({ error: state.error }); return;
  }

  startVideoProcess(filePath, rtmpUrl, state.format, state.volume, state.loopMode === "playlist");
  res.json(getPublicState());
});

router.post("/volume", (req, res) => {
  if (!state.isStreaming) {
    res.status(404).json({ error: "Nenhuma live ativa." }); return;
  }
  const rawVol = Number(req.body?.volume);
  if (!Number.isInteger(rawVol) || rawVol < 0 || rawVol > 100) {
    res.status(400).json({ error: "Volume deve ser um número inteiro entre 0 e 100." }); return;
  }
  state.volume = rawVol;

  if (state.isPaused) { res.json(getPublicState()); return; }

  const proc = state.process;
  state.process = null;
  if (proc) killProcess(proc);

  const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${state.streamKey}`;
  const filePath = path.join(UPLOADS_DIR, state.videoFile!);

  if (!fs.existsSync(filePath)) {
    state.isStreaming = false;
    state.error = "Arquivo de vídeo não encontrado.";
    res.status(400).json({ error: state.error }); return;
  }

  startVideoProcess(filePath, rtmpUrl, state.format, rawVol, state.loopMode === "playlist");
  res.json(getPublicState());
});

// ── Switch video mid-stream ───────────────────────────────────────────────────

router.post("/switch-video", (req, res) => {
  if (!state.isStreaming) {
    res.status(404).json({ error: "Nenhuma live ativa." }); return;
  }
  const { videoFile } = req.body as { videoFile?: string };
  if (!videoFile || typeof videoFile !== "string") {
    res.status(400).json({ error: "videoFile é obrigatório." }); return;
  }
  const filePath = path.join(UPLOADS_DIR, videoFile);
  if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) {
    res.status(400).json({ error: "Arquivo não encontrado. Faça o upload primeiro." }); return;
  }

  const proc = state.process;
  state.process = null;
  state.videoFile = videoFile;

  if (state.isPaused) {
    // Just update the video reference; it'll apply on resume
    if (proc) killProcess(proc);
    const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${state.streamKey}`;
    state.process = spawnFfmpeg(buildPauseArgs(rtmpUrl, state.format), (code) => {
      if (!state.isPaused) return;
      state.isStreaming = false;
      state.isPaused = false;
      state.process = null;
      if (code !== 0) state.error = "Conexão pausada perdida. Reinicie a live.";
    });
    res.json(getPublicState()); return;
  }

  if (proc) killProcess(proc);

  const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${state.streamKey}`;
  startVideoProcess(filePath, rtmpUrl, state.format, state.volume, state.loopMode === "playlist");
  res.json(getPublicState());
});

// ── Playlist ──────────────────────────────────────────────────────────────────

router.post("/playlist", (req, res) => {
  const { playlist } = req.body as { playlist?: string[] };
  if (!Array.isArray(playlist)) {
    res.status(400).json({ error: "playlist deve ser um array de filenames." }); return;
  }

  state.playlist = playlist;
  state.loopMode = playlist.length > 1 ? "playlist" : "single";

  // If already streaming, update the index to keep current video position
  if (state.isStreaming && state.videoFile) {
    const idx = playlist.indexOf(state.videoFile);
    state.playlistIndex = idx >= 0 ? idx : 0;
  }

  res.json(getPublicState());
});

// ── YouTube import (yt-dlp) ───────────────────────────────────────────────────

router.post("/import/list", async (req, res) => {
  const available = await ytDlpAvailable();
  if (!available) {
    res.status(503).json({ error: "yt-dlp não está disponível neste servidor." }); return;
  }

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url é obrigatório." }); return;
  }

  // Validate it's a YouTube URL
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    res.status(400).json({ error: "Use uma URL do YouTube (canal, playlist ou vídeo)." }); return;
  }

  execFile(
    "yt-dlp",
    [
      "--flat-playlist",
      "--print", "%(id)s\t%(title)s\t%(duration)s\t%(thumbnail)s\t%(webpage_url)s",
      "--playlist-end", "50", // max 50 videos
      "--no-warnings",
      url,
    ],
    { timeout: 30000 },
    (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        res.status(400).json({ error: `Falha ao listar vídeos: ${msg.slice(0, 200)}` }); return;
      }

      const videos = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, title, duration, thumbnail, videoUrl] = line.split("\t");
          return {
            id: id ?? "",
            title: title ?? "(sem título)",
            duration: duration && duration !== "NA" ? Number(duration) : null,
            thumbnail: thumbnail && thumbnail !== "NA" ? thumbnail : null,
            url: videoUrl ?? `https://www.youtube.com/watch?v=${id}`,
          };
        })
        .filter((v) => v.id);

      res.json({ videos });
    },
  );
});

router.post("/import/download", async (req, res) => {
  const available = await ytDlpAvailable();
  if (!available) {
    res.status(503).json({ error: "yt-dlp não está disponível neste servidor." }); return;
  }

  const { url, title } = req.body as { url?: string; title?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url é obrigatório." }); return;
  }
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    res.status(400).json({ error: "Use uma URL do YouTube." }); return;
  }

  const jobId = crypto.randomUUID();
  const safeTitle = (title ?? "video").replace(/[^a-z0-9]/gi, "_").slice(0, 60);
  const outputTemplate = path.join(UPLOADS_DIR, `${safeTitle}_${Date.now()}.%(ext)s`);

  const job: DownloadJob = {
    jobId,
    status: "downloading",
    percent: 0,
    filename: null,
    error: null,
    title: title ?? "Vídeo",
  };
  downloadJobs.set(jobId, job);

  const proc = spawn("yt-dlp", [
    "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--output", outputTemplate,
    "--no-playlist",
    "--newline",
    url,
  ]);

  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    // Parse progress lines like: [download]  42.3% of ...
    const match = text.match(/\[download\]\s+([\d.]+)%/);
    if (match) {
      job.percent = parseFloat(match[1]!);
    }
    // Detect final filename
    const destMatch = text.match(/\[(?:download|Merger)\] Destination:\s*(.+)/);
    if (destMatch) {
      job.filename = path.basename(destMatch[1]!.trim());
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    const match = text.match(/\[download\]\s+([\d.]+)%/);
    if (match) job.percent = parseFloat(match[1]!);
  });

  proc.on("close", (code) => {
    if (code === 0) {
      job.status = "done";
      job.percent = 100;

      // Try to find the actual output file if we lost the filename
      if (!job.filename) {
        const prefix = path.basename(outputTemplate.replace(".%(ext)s", ""));
        const files = fs.readdirSync(UPLOADS_DIR).filter((f) => f.startsWith(prefix.split("_").slice(0, -1).join("_")));
        if (files.length > 0) job.filename = files[files.length - 1]!;
      }

      // Save metadata
      if (job.filename) {
        saveMeta(job.filename, title ?? job.filename);
      }
    } else {
      job.status = "error";
      job.error = `yt-dlp encerrou com código ${code}`;
    }
  });

  proc.on("error", (err) => {
    job.status = "error";
    job.error = err.message;
  });

  res.json({ jobId, title: job.title });
});

router.get("/import/progress/:jobId", (req, res) => {
  const job = downloadJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job não encontrado." }); return; }
  res.json({
    jobId: job.jobId,
    status: job.status,
    percent: job.percent,
    filename: job.filename,
    error: job.error,
  });
});

export default router;
