import { useState, useRef, useCallback } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useGetStreamStatus,
  useStartStream,
  useStopStream,
  useListVideos,
  getGetStreamStatusQueryKey,
  getListVideosQueryKey,
} from "@workspace/api-client-react";

const queryClient = new QueryClient();

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

function StreamerApp() {
  const qc = useQueryClient();

  const { data: status, refetch: refetchStatus } = useGetStreamStatus({
    query: { refetchInterval: 3000 },
  });

  const { data: videos } = useListVideos();

  const startMutation = useStartStream({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() });
      },
    },
  });

  const stopMutation = useStopStream({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetStreamStatusQueryKey() });
      },
    },
  });

  const [streamKey, setStreamKey] = useState("");
  const [selectedVideo, setSelectedVideo] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [elapsed, setElapsed] = useState("00:00:00");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback((startedAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed(formatDuration(startedAt));
    }, 1000);
  }, []);

  if (status?.isStreaming && status.startedAt && !timerRef.current) {
    startTimer(status.startedAt);
  }
  if (!status?.isStreaming && timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
    setElapsed("00:00:00");
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError("");
    setUploadProgress(0);

    const form = new FormData();
    form.append("video", file);

    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/api/stream/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          qc.invalidateQueries({ queryKey: getListVideosQueryKey() });
          setSelectedVideo(data.filename);
          resolve();
        } else {
          const err = JSON.parse(xhr.responseText);
          setUploadError(err.error || "Erro ao fazer upload");
          reject();
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        setUploadError("Erro de conexão");
        reject();
      };

      xhr.send(form);
    });
  }

  function handleStart() {
    if (!streamKey.trim() || !selectedVideo) return;
    startMutation.mutate({ data: { streamKey: streamKey.trim(), videoFile: selectedVideo } });
  }

  function handleStop() {
    stopMutation.mutate();
  }

  const isStreaming = status?.isStreaming ?? false;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center">
          <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <h1 className="text-lg font-bold tracking-tight">YouTube Live Streamer</h1>
        <div className="ml-auto flex items-center gap-2">
          {isStreaming && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-400 bg-red-950 border border-red-800 px-3 py-1.5 rounded-full animate-pulse">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>
              AO VIVO • {elapsed}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-6">

        {/* Status Card */}
        {isStreaming && (
          <div className="bg-red-950 border border-red-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-red-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block animate-pulse"/>
                Live ativa
              </span>
              <span className="text-sm text-red-400 font-mono">{elapsed}</span>
            </div>
            <p className="text-sm text-red-300 truncate">
              Vídeo: <span className="text-white">{status?.videoFile ?? "—"}</span>
            </p>
            {status?.startedAt && (
              <p className="text-xs text-red-500 mt-1">
                Iniciada às {new Date(status.startedAt).toLocaleTimeString("pt-BR")}
              </p>
            )}
          </div>
        )}

        {status?.error && !isStreaming && (
          <div className="bg-orange-950 border border-orange-800 rounded-2xl p-4 text-sm text-orange-300">
            ⚠️ {status.error}
          </div>
        )}

        {/* Upload Section */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wider mb-4">1. Vídeo para a Live</h2>

          {/* Drop zone */}
          <div
            className="border-2 border-dashed border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-gray-500 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleUpload(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp4,.mov,.avi,.mkv,.webm,.flv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
            {uploading ? (
              <div className="space-y-3">
                <div className="text-sm text-gray-400">Enviando vídeo... {uploadProgress}%</div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div
                    className="bg-red-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div>
                <svg className="w-10 h-10 mx-auto text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
                <p className="text-sm text-gray-400">Clique ou arraste o vídeo aqui</p>
                <p className="text-xs text-gray-600 mt-1">MP4, MOV, AVI, MKV, WEBM • Até 2GB</p>
              </div>
            )}
          </div>

          {uploadError && (
            <p className="text-sm text-red-400 mt-2">⚠️ {uploadError}</p>
          )}

          {/* Video list */}
          {videos && videos.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Vídeos disponíveis</p>
              {videos.map((v) => (
                <button
                  key={v.filename}
                  onClick={() => setSelectedVideo(v.filename)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all ${
                    selectedVideo === v.filename
                      ? "border-red-600 bg-red-950 text-white"
                      : "border-gray-800 bg-gray-800/50 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className="truncate text-left">{v.originalName}</span>
                  <span className="text-xs text-gray-500 ml-3 shrink-0">{formatBytes(v.size)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stream Key Section */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wider mb-4">2. Chave de Stream do YouTube</h2>
          <p className="text-xs text-gray-500 mb-3">
            YouTube Studio → Transmissões ao vivo → Chave de stream
          </p>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={streamKey}
              onChange={(e) => setStreamKey(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-600 pr-12"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showKey ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Action Button */}
        <div className="pb-4">
          {isStreaming ? (
            <button
              onClick={handleStop}
              disabled={stopMutation.isPending}
              className="w-full py-4 rounded-2xl font-semibold text-base bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all disabled:opacity-50"
            >
              {stopMutation.isPending ? "Parando..." : "⏹ Parar Live"}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!streamKey.trim() || !selectedVideo || startMutation.isPending || uploading}
              className="w-full py-4 rounded-2xl font-semibold text-base bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:border disabled:border-gray-700 transition-all"
            >
              {startMutation.isPending ? "Iniciando..." : "🔴 Iniciar Live em Loop"}
            </button>
          )}

          {startMutation.isError && (
            <p className="text-sm text-red-400 mt-3 text-center">
              {(startMutation.error as { data?: { error?: string } })?.data?.error ?? "Erro ao iniciar a live"}
            </p>
          )}

          {!selectedVideo && !isStreaming && (
            <p className="text-xs text-gray-600 text-center mt-3">Selecione um vídeo para começar</p>
          )}
          {selectedVideo && !streamKey.trim() && !isStreaming && (
            <p className="text-xs text-gray-600 text-center mt-3">Digite sua chave de stream do YouTube</p>
          )}
        </div>

        {/* Help */}
        <div className="border-t border-gray-800 pt-6 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Como pegar a chave de stream</h3>
          <ol className="text-sm text-gray-500 space-y-1.5 list-decimal list-inside">
            <li>Acesse <span className="text-gray-300">studio.youtube.com</span></li>
            <li>Clique em <span className="text-gray-300">Criar → Transmitir ao vivo</span></li>
            <li>Escolha <span className="text-gray-300">Transmissão por codificador</span></li>
            <li>Copie a <span className="text-gray-300">Chave de stream</span></li>
          </ol>
        </div>
      </div>
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
