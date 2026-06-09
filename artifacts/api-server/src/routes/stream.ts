import { Router } from "express";
import { spawn, type ChildProcess } from "child_process";
import multer from "multer";
import path from "path";
import fs from "fs";
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
};

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
  volume: number
): string[] {
  const volumeFilter = volume === 100 ? [] : ["-af", `volume=${(volume / 100).toFixed(2)}`];
  const shortsFilter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1";
  const videoFilter = format === "shorts" ? ["-vf", shortsFilter] : [];

  // Combine video + audio filters if both needed
  let filters: string[] = [];
  if (format === "shorts" && volume !== 100) {
    filters = ["-vf", shortsFilter, "-af", `volume=${(volume / 100).toFixed(2)}`];
  } else {
    filters = [...videoFilter, ...volumeFilter];
  }

  return [
    "-re",
    "-stream_loop", "-1",
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

function spawnFfmpeg(args: string[], onClose: (code: number | null) => void): ChildProcess {
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

  proc.stderr.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) state.ffmpegLog.push(trimmed);
    }
    if (state.ffmpegLog.length > 100) state.ffmpegLog = state.ffmpegLog.slice(-100);
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

router.get("/status", (_req, res) => {
  res.json(getPublicState());
});

router.get("/videos", (_req, res) => {
  if (!fs.existsSync(UPLOADS_DIR)) { res.json([]); return; }
  const metaPath = path.join(UPLOADS_DIR, "meta.json");
  let meta: Record<string, { originalName: string; uploadedAt: string }> = {};
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch { meta = {}; }
  }
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter((f) => f !== "meta.json")
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
  if (state.isStreaming && state.videoFile === filename) {
    res.status(409).json({ error: "Não é possível deletar o vídeo enquanto a live está ativa." }); return;
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Arquivo não encontrado." }); return; }
  fs.unlinkSync(filePath);
  const metaPath = path.join(UPLOADS_DIR, "meta.json");
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      delete meta[filename];
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    } catch { /* ignore */ }
  }
  res.json({ deleted: filename });
});

router.post("/upload", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err) { res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "Nenhum arquivo enviado." }); return; }
    const metaPath = path.join(UPLOADS_DIR, "meta.json");
    let meta: Record<string, { originalName: string; uploadedAt: string }> = {};
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch { meta = {}; }
    }
    meta[req.file.filename] = { originalName: req.file.originalname, uploadedAt: new Date().toISOString() };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json({ filename: req.file.filename, originalName: req.file.originalname, size: req.file.size });
  });
});

router.post("/start", (req, res) => {
  if (state.isStreaming) {
    res.status(409).json({ error: "Já existe uma live ativa. Pare a atual antes de iniciar uma nova." }); return;
  }
  const parsed = StartStreamBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "streamKey e videoFile são obrigatórios." }); return; }

  const { streamKey, videoFile, format = "landscape", volume = 100 } = parsed.data;
  const filePath = path.join(UPLOADS_DIR, videoFile);
  if (!fs.existsSync(filePath)) { res.status(400).json({ error: "Arquivo de vídeo não encontrado. Faça o upload primeiro." }); return; }

  const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${streamKey}`;
  const fmt = (format === "shorts" ? "shorts" : "landscape") as StreamFormat;
  const vol = Math.max(0, Math.min(100, Number(volume) || 100));

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

  state.process = spawnFfmpeg(buildFfmpegArgs(filePath, rtmpUrl, fmt, vol), (code) => {
    if (state.isPaused) return; // paused intentionally, don't treat as error
    state.isStreaming = false;
    state.process = null;
    if (code !== 0) {
      const findLast = (lines: string[], pred: (l: string) => boolean): string | undefined => {
        for (let i = lines.length - 1; i >= 0; i--) if (pred(lines[i]!)) return lines[i];
        return undefined;
      };
      const rtmpError = findLast(state.ffmpegLog, (l) => l.includes("rtmp") || l.includes("Connection") || l.includes("Failed") || l.includes("error") || l.includes("Error"));
      state.error = rtmpError ? `Stream key inválida ou expirada: ${rtmpError}` : `FFmpeg encerrou com código ${code}. Verifique a stream key.`;
    }
  });

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

  // Start black frame stream to keep RTMP alive
  const rtmpUrl = `rtmp://x.rtmp.youtube.com/live2/${state.streamKey}`;
  state.process = spawnFfmpeg(buildPauseArgs(rtmpUrl, state.format), (code) => {
    if (!state.isPaused) return;
    // Pause stream dropped, mark as stopped
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

  state.process = spawnFfmpeg(buildFfmpegArgs(filePath, rtmpUrl, state.format, state.volume), (code) => {
    if (state.isPaused) return;
    state.isStreaming = false;
    state.process = null;
    if (code !== 0) {
      const findLast = (lines: string[], pred: (l: string) => boolean): string | undefined => {
        for (let i = lines.length - 1; i >= 0; i--) if (pred(lines[i]!)) return lines[i];
        return undefined;
      };
      const rtmpError = findLast(state.ffmpegLog, (l) => l.includes("rtmp") || l.includes("error") || l.includes("Error"));
      state.error = rtmpError ? `Reconexão falhou: ${rtmpError}` : "Falha ao retomar stream.";
    }
  });

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
  const newVol = rawVol;
  state.volume = newVol;

  if (state.isPaused) {
    // Just update the stored volume, will apply on resume
    res.json(getPublicState()); return;
  }

  // Restart FFmpeg with new volume
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

  state.process = spawnFfmpeg(buildFfmpegArgs(filePath, rtmpUrl, state.format, newVol), (code) => {
    if (state.isPaused) return;
    state.isStreaming = false;
    state.process = null;
    if (code !== 0) state.error = "Stream encerrada após mudança de volume.";
  });

  res.json(getPublicState());
});

export default router;
