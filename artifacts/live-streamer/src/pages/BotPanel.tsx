import { useState, useEffect, useRef } from "react";

const LS_KEY = "ylive_ezbot_url";
const LS_TOKEN = "ylive_ezbot_token";

type BotState = {
  online: boolean;
  name?: string;
  health?: number;
  food?: number;
  posStr?: string;
  missionDesc?: string;
  aiProvider?: string;
  stats?: Record<string, number>;
  inventory?: { name: string; count: number }[];
  reason?: string;
};

interface BotPanelProps {
  accent: string;
}

export default function BotPanel({ accent }: BotPanelProps) {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(LS_KEY) || "");
  const [apiToken, setApiToken] = useState(() => localStorage.getItem(LS_TOKEN) || "");
  const [urlDraft, setUrlDraft] = useState(apiUrl);
  const [tokenDraft, setTokenDraft] = useState(apiToken);
  const [botState, setBotState] = useState<BotState | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [chatMsg, setChatMsg] = useState("");
  const [chatUser, setChatUser] = useState("Admin");
  const [chatLog, setChatLog] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function saveCreds() {
    const u = urlDraft.trim().replace(/\/$/, "");
    setApiUrl(u); setApiToken(tokenDraft.trim());
    localStorage.setItem(LS_KEY, u);
    localStorage.setItem(LS_TOKEN, tokenDraft.trim());
  }

  useEffect(() => {
    if (!apiUrl) return;
    async function fetchStatus() {
      try {
        const r = await fetch(`${apiUrl}/api/bot/status`, { cache: "no-store" });
        setBotState(await r.json());
      } catch {
        setBotState({ online: false, reason: "Erro de conexão" });
      }
    }
    fetchStatus();
    intervalRef.current = setInterval(() => { fetchStatus(); setLastRefresh(Date.now()); }, 4000);
    return () => clearInterval(intervalRef.current!);
  }, [apiUrl]);

  useEffect(() => {
    const t = setInterval(() => setLastRefresh(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);

  async function sendChat() {
    if (!chatMsg.trim() || !apiUrl || !apiToken) return;
    try {
      const r = await fetch(`${apiUrl}/api/bot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiToken },
        body: JSON.stringify({ username: chatUser, message: chatMsg }),
      });
      if (r.ok) {
        setChatLog(l => [`✅ ${chatUser}: ${chatMsg}`, ...l.slice(0, 9)]);
        setChatMsg("");
      } else {
        setChatLog(l => [`❌ Erro ao enviar`, ...l.slice(0, 9)]);
      }
    } catch {
      setChatLog(l => [`❌ Conexão falhou`, ...l.slice(0, 9)]);
    }
  }

  const online = botState?.online ?? false;
  const hp = botState?.health ?? 0;
  const food = botState?.food ?? 0;

  return (
    <div className="space-y-5">
      {/* Config */}
      <div className="card p-5">
        <h3 className="font-bold text-sm mb-4">⚙️ Conexão com EzBot_IA</h3>
        <div className="grid md:grid-cols-2 gap-3 mb-3">
          <div>
            <p className="text-[11px] text-white/30 mb-1.5 font-semibold uppercase tracking-widest">URL da API</p>
            <input type="text" value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
              placeholder="https://xxxxx.replit.app"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none" />
          </div>
          <div>
            <p className="text-[11px] text-white/30 mb-1.5 font-semibold uppercase tracking-widest">API Token</p>
            <input type="password" value={tokenDraft} onChange={e => setTokenDraft(e.target.value)}
              placeholder="Bearer token do EzBot_IA"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none" />
          </div>
        </div>
        <button onClick={saveCreds} className="px-4 py-2 rounded-xl text-sm font-bold text-black accent-bg">
          Salvar Configuração
        </button>
      </div>

      {!apiUrl ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-4">🤖</p>
          <p className="text-white/40">Configure a URL da API acima para conectar ao bot.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {/* Left: Map + status */}
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm">🗺️ Mini-Mapa ao Vivo</h3>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${online ? "live-badge" : "bg-red-500/12 text-red-400 border border-red-500/25"}`}>
                  <span className={`relative flex h-2 w-2`}>
                    {online && <span className="live-ring absolute inline-flex h-full w-full rounded-full live-dot opacity-75" />}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${online ? "live-dot" : "bg-red-400"}`} />
                  </span>
                  {online ? `${botState?.name || "FactWiki"} Online` : "Offline"}
                </div>
              </div>
              <img src={`${apiUrl}/api/stream/preview?t=${lastRefresh}`} alt="Mini-mapa"
                className="w-full rounded-xl border border-white/[0.06]" />
              <p className="text-[10px] text-white/20 mt-2 text-center">
                Atualiza a cada 3s •{" "}
                <a href={`${apiUrl}/api/stream/preview`} target="_blank" rel="noopener noreferrer" className="accent-text">Ver imagem</a>
              </p>
            </div>

            {/* HP & Food */}
            <div className="card p-4 space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white/40">❤️ HP</span>
                  <span className={`font-bold ${hp > 14 ? "text-green-400" : hp > 8 ? "text-amber-400" : "text-red-400"}`}>{hp}/20</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(hp/20)*100}%`, background: hp > 14 ? "#4CAF50" : hp > 8 ? "#FF9800" : "#F44336" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white/40">🍖 Fome</span>
                  <span className="font-bold text-amber-400">{food}/20</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${(food/20)*100}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Right: Stats + controls */}
          <div className="space-y-4">
            <div className="card p-4">
              <h3 className="font-bold text-sm mb-3">📊 Status do Bot</h3>
              <div className="space-y-2">
                {[
                  ["📍 Posição", botState?.posStr],
                  ["🎯 Missão", botState?.missionDesc],
                  ["🤖 IA Ativa", botState?.aiProvider],
                  ["⚔️ Mobs Mortos", botState?.stats?.mobsKilled],
                  ["💎 Diamantes", botState?.stats?.diamondCollected],
                  ["💀 Mortes", botState?.stats?.deaths],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between items-center py-1.5 border-b border-white/[0.04] text-xs">
                    <span className="text-white/40">{k}</span>
                    <span className="font-semibold text-white/70">{String(v ?? "—")}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat Overlay */}
            <div className="card p-4">
              <h3 className="font-bold text-sm mb-3">💬 Enviar ao Chat Overlay</h3>
              <div className="space-y-2 mb-3">
                <input type="text" value={chatUser} onChange={e => setChatUser(e.target.value)}
                  placeholder="Usuário" className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none" />
                <div className="flex gap-2">
                  <input type="text" value={chatMsg} onChange={e => setChatMsg(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendChat()}
                    placeholder="Mensagem para o overlay..." className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none" />
                  <button onClick={sendChat} className="px-3 py-2 rounded-xl text-xs font-bold text-black accent-bg">→</button>
                </div>
              </div>
              {chatLog.length > 0 && (
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {chatLog.map((l, i) => <p key={i} className="text-[10px] text-white/30">{l}</p>)}
                </div>
              )}
            </div>

            {/* Inventory */}
            {(botState?.inventory?.length ?? 0) > 0 && (
              <div className="card p-4">
                <h3 className="font-bold text-sm mb-3">🎒 Inventário</h3>
                <div className="grid grid-cols-4 gap-2">
                  {botState!.inventory!.slice(0, 12).map(item => (
                    <div key={item.name} className="card-inner p-2 text-center">
                      <div className="font-bold text-sm accent-text">{item.count}</div>
                      <div className="text-[9px] text-white/30 mt-0.5 break-words leading-tight">{item.name.replace(/_/g, " ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
