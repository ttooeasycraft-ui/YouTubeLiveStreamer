import { useState } from "react";

const LS_KEY = "ylive_ezbot_url";
const LS_TOKEN = "ylive_ezbot_token";

interface EditorPanelProps {
  accent: string;
}

const PRESETS = [
  { id: "normal", label: "Normal", br: 1, ct: 1, sat: 1 },
  { id: "sepia", label: "Sépia", br: 1.1, ct: 1.1, sat: 0.3 },
  { id: "pb", label: "P&B", br: 1, ct: 1.1, sat: 0 },
  { id: "vivid", label: "Vívido", br: 1.1, ct: 1.2, sat: 1.8 },
  { id: "dark", label: "Dark", br: 0.6, ct: 1.1, sat: 0.8 },
  { id: "neon", label: "Neon", br: 1, ct: 1.3, sat: 2.5 },
];

type Preset = typeof PRESETS[number];

export default function EditorPanel({ accent: _accent }: EditorPanelProps) {
  const apiUrl = localStorage.getItem(LS_KEY) || "";
  const apiToken = localStorage.getItem(LS_TOKEN) || "";

  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [opacity, setOpacity] = useState(85);
  const [activePreset, setActivePreset] = useState("normal");

  const [statsVisible, setStatsVisible] = useState(true);
  const [missionVisible, setMissionVisible] = useState(true);
  const [chatVisible, setChatVisible] = useState(true);
  const [mapVisible, setMapVisible] = useState(true);

  const [widgetUrl, setWidgetUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [customText, setCustomText] = useState("");
  const [customX, setCustomX] = useState(12);
  const [customY, setCustomY] = useState(40);
  const [customSize, setCustomSize] = useState(22);
  const [customColor, setCustomColor] = useState("white");

  const [log, setLog] = useState<{ msg: string; ok: boolean }[]>([]);
  const [sending, setSending] = useState(false);

  function addLog(msg: string, ok: boolean) {
    setLog(l => [{ msg, ok }, ...l.slice(0, 14)]);
  }

  async function applyUpdate(extra?: Record<string, unknown>) {
    if (!apiUrl || !apiToken) {
      addLog("❌ Configure a URL e token na aba EzBot", false);
      return;
    }
    setSending(true);
    try {
      const body = {
        brightness, contrast, saturation,
        overlayOpacity: opacity,
        statsVisible, missionVisible, chatVisible, mapVisible,
        customText: customText || undefined,
        customTextX: customX, customTextY: customY,
        customTextSize: customSize, customTextColor: customColor,
        widgetUrl: widgetUrl || undefined,
        ...extra,
      };
      const r = await fetch(`${apiUrl}/api/live-editor-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiToken },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        addLog("✅ Overlays atualizados ao vivo", true);
      } else {
        const j = await r.json();
        addLog("❌ " + (j.error || r.statusText), false);
      }
    } catch (e) {
      addLog("❌ Erro de conexão", false);
    } finally {
      setSending(false);
    }
  }

  function applyPreset(p: Preset) {
    setActivePreset(p.id);
    setBrightness(p.br);
    setContrast(p.ct);
    setSaturation(p.sat);
  }

  function SliderRow({ label, value, min, max, step, onChange }: {
    label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
  }) {
    return (
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-white/50 font-semibold">{label}</span>
          <span className="text-xs font-bold accent-text">{value.toFixed(2)}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="w-full" />
      </div>
    );
  }

  function Toggle({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-white/[0.04]">
        <div>
          <p className="text-sm font-medium">{label}</p>
          {desc && <p className="text-xs text-white/30 mt-0.5">{desc}</p>}
        </div>
        <button onClick={() => onChange(!value)}
          className={`relative w-11 h-6 rounded-full transition-colors ${value ? "accent-bg" : "bg-white/10"}`}>
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-5">
      {/* Left */}
      <div className="space-y-5">
        <div className="card p-5">
          <h3 className="font-bold text-sm mb-4">🎨 Filtros de Cor</h3>
          <SliderRow label="Brilho" value={brightness} min={0.3} max={2} step={0.05} onChange={setBrightness} />
          <SliderRow label="Contraste" value={contrast} min={0.3} max={2} step={0.05} onChange={setContrast} />
          <SliderRow label="Saturação" value={saturation} min={0} max={3} step={0.05} onChange={setSaturation} />
          <SliderRow label="Opacidade dos Overlays" value={opacity} min={0} max={100} step={5} onChange={v => setOpacity(Math.round(v))} />

          <div className="mt-4">
            <p className="text-[11px] text-white/30 uppercase tracking-widest font-semibold mb-2">Filtro Rápido</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button key={p.id} onClick={() => applyPreset(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activePreset === p.id ? "accent-bg text-black" : "btn-ghost text-white/50"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-sm mb-4">🌐 Links de Widgets Externos</h3>
          <p className="text-xs text-white/30 mb-3">Cole URLs de overlays (Streamlabs, StreamElements, QR Code, metas) para exibir na live.</p>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-white/30 mb-1 font-semibold uppercase tracking-widest">Widget / Overlay URL</p>
              <input type="url" value={widgetUrl} onChange={e => setWidgetUrl(e.target.value)}
                placeholder="https://streamlabs.com/widgets/goal/..."
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none" />
            </div>
            <div>
              <p className="text-[11px] text-white/30 mb-1 font-semibold uppercase tracking-widest">Imagem Flutuante (QR Code, logo)</p>
              <input type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                placeholder="https://i.imgur.com/exemplo.png"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Right */}
      <div className="space-y-5">
        <div className="card p-5">
          <h3 className="font-bold text-sm mb-1">👁 Visibilidade das Camadas</h3>
          <Toggle label="📊 Stats do Bot" desc="HP, posição, IA ativa — canto superior esq" value={statsVisible} onChange={setStatsVisible} />
          <Toggle label="🎯 Missão Atual" desc="Canto superior direito" value={missionVisible} onChange={setMissionVisible} />
          <Toggle label="💬 Chat das Plataformas" desc="Últimas 6 linhas — canto inferior esq" value={chatVisible} onChange={setChatVisible} />
          <Toggle label="🗺️ Mini-Mapa" desc="Visível no overlay da live" value={mapVisible} onChange={setMapVisible} />
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-sm mb-4">✍️ Texto Personalizado</h3>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-white/30 mb-1 font-semibold uppercase tracking-widest">Texto (watermark, anúncio)</p>
              <input type="text" value={customText} onChange={e => setCustomText(e.target.value)}
                placeholder="EzBot_IA Live • factionsmatrix.com"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-white/30 mb-1 font-semibold uppercase tracking-widest">Posição X</p>
                <input type="number" value={customX} onChange={e => setCustomX(Number(e.target.value))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none" />
              </div>
              <div>
                <p className="text-[11px] text-white/30 mb-1 font-semibold uppercase tracking-widest">Posição Y</p>
                <input type="number" value={customY} onChange={e => setCustomY(Number(e.target.value))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none" />
              </div>
              <div>
                <p className="text-[11px] text-white/30 mb-1 font-semibold uppercase tracking-widest">Tamanho</p>
                <input type="number" value={customSize} onChange={e => setCustomSize(Number(e.target.value))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none" />
              </div>
              <div>
                <p className="text-[11px] text-white/30 mb-1 font-semibold uppercase tracking-widest">Cor</p>
                <input type="text" value={customColor} onChange={e => setCustomColor(e.target.value)}
                  placeholder="white, #FFD700..."
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none" />
              </div>
            </div>
          </div>
        </div>

        <button onClick={() => applyUpdate()} disabled={sending || !apiUrl}
          className="w-full py-3 rounded-xl font-bold text-sm text-black accent-bg disabled:opacity-30">
          {sending ? "⏳ Aplicando..." : "⚡ Aplicar ao Vivo"}
        </button>

        {/* Log */}
        {log.length > 0 && (
          <div className="card p-4">
            <h3 className="font-bold text-xs text-white/30 uppercase tracking-widest mb-2">Log</h3>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {log.map((l, i) => (
                <p key={i} className={`text-xs ${l.ok ? "text-green-400" : "text-red-400"}`}>{l.msg}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
