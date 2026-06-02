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
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Formato de arquivo não suportado. Use MP4, MOV, AVI, MKV, WEBM ou FLV."));
    }
  },
});

type StreamFormat = "landscape" | "shorts";

interface StreamState {
  isStreaming: boolean;
  videoFile: string | null;
  streamKey: string | null;
  format: StreamFormat;
  startedAt: string | null;
  error: string | null;
  ffmpegLog: string[];
  process: ChildProcess | null;
}

const state: StreamState = {
  isStreaming: false,
  videoFile: null,
  streamKey: null,
  format: "landscape",
  startedAt: null,
  error: null,
  ffmpegLog: [],
  process: null,
};

function getPublicState() {
  return {
    isStreaming: state.isStreaming,
    videoFile: state.videoFile,
    streamKey: state.streamKey ? state.streamKey.slice(0, 4) + "****" : null,
    format: state.format,
    startedAt: state.startedAt,
    error: state.error,
    ffmpegLog: state.ffmpegLog.slice(-20),
  };
}

router.get("/status", (_req, res) => {
  res.json(getPublicState());
});

router.get("/videos", (_req, res) => {
  if (!fs.existsSync(UPLOADS_DIR)) {
    res.json([]);
    return;
  }
  const metaPath = path.join(UPLOADS_DIR, "meta.json");
  let meta: Record<string, { originalName: string; uploadedAt: string }> = {};
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch {
      meta = {};
    }
  }

  const files = fs
    .readdirSync(UPLOADS_DIR)
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

router.post("/upload", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado." });
      return;
    }

    const metaPath = path.join(UPLOADS_DIR, "meta.json");
    let meta: Record<string, { originalName: string; uploadedAt: string }> = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      } catch {
        meta = {};
      }
    }
    meta[req.file.filename] = {
      originalName: req.file.originalname,
      uploadedAt: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    res.json({
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
});

router.post("/start", (req, res) => {
  if (state.isStreaming) {
    res.status(409).json({ error: "Já existe uma live ativa. Pare a atual antes de iniciar uma nova." });
    return;
  }

  const parsed = StartStreamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "streamKey e videoFile são obrigatórios." });
    return;
  }

  const { streamKey, videoFile, format = "landscape" } = parsed.data;
  const filePath = path.join(UPLOADS_DIR, videoFile);

  if (!fs.existsSync(filePath)) {
    res.status(400).json({ error: "Arquivo de vídeo não encontrado. Faça o upload primeiro." });
    return;
  }

  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

  // Shorts = portrait 1080×1920 (9:16). Scale to fit, pad with black bars.
  const shortsFilter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1";

  const ffmpegArgs = [
    "-re",
    "-stream_loop", "-1",
    "-i", filePath,
    ...(format === "shorts" ? ["-vf", shortsFilter] : []),
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

  const proc = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });

  state.isStreaming = true;
  state.videoFile = videoFile;
  state.streamKey = streamKey;
  state.format = (format === "shorts" ? "shorts" : "landscape") as StreamFormat;
  state.startedAt = new Date().toISOString();
  state.error = null;
  state.ffmpegLog = [];
  state.process = proc;

  // Capture FFmpeg output (FFmpeg writes progress/errors to stderr)
  let stderrBuf = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) state.ffmpegLog.push(trimmed);
    }
    if (state.ffmpegLog.length > 100) state.ffmpegLog = state.ffmpegLog.slice(-100);
  });

  proc.on("error", (err) => {
    state.isStreaming = false;
    state.error = err.message === "spawn ffmpeg ENOENT"
      ? "FFmpeg não encontrado no servidor. Verifique a instalação."
      : err.message;
    state.process = null;
  });

  proc.on("close", (code) => {
    state.isStreaming = false;
    state.process = null;
    if (stderrBuf.trim()) state.ffmpegLog.push(stderrBuf.trim());
    const findLastMatch = (lines: string[], pred: (l: string) => boolean): string | undefined => {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (pred(lines[i]!)) return lines[i];
      }
      return undefined;
    };
    if (code !== 0) {
      const rtmpError = findLastMatch(state.ffmpegLog,
        (l) => l.includes("rtmp") || l.includes("Connection") || l.includes("Failed") || l.includes("refused") || l.includes("error") || l.includes("Error")
      );
      state.error = rtmpError
        ? `Stream key inválida ou expirada: ${rtmpError}`
        : `FFmpeg encerrou com código ${code}. Verifique a stream key e tente novamente.`;
    } else {
      const rtmpError = findLastMatch(state.ffmpegLog,
        (l) => l.includes("rtmp") || l.includes("Connection") || l.includes("refused") || l.includes("RTMP")
      );
      if (rtmpError) {
        state.error = `YouTube recusou a conexão: ${rtmpError}`;
      }
    }
  });

  res.json(getPublicState());
});

router.post("/stop", (_req, res) => {
  if (!state.isStreaming || !state.process) {
    res.status(404).json({ error: "Nenhuma live ativa no momento." });
    return;
  }

  state.process.kill("SIGTERM");
  state.isStreaming = false;
  state.process = null;
  state.error = null;

  res.json(getPublicState());
});

export default router;
