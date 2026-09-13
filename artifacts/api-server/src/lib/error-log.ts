import fs from "node:fs";
import path from "node:path";

const ERROR_LOG_PATH = path.join(process.cwd(), "erros.log");

export function logApiError(etapa: string, error: unknown): void {
  const entry = {
    data: new Date().toISOString(),
    etapa,
    tipo: error instanceof Error ? error.name : typeof error,
    mensagem: error instanceof Error ? error.message : String(error),
  };

  try {
    fs.appendFileSync(ERROR_LOG_PATH, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
  } catch {
    // Logging must never interrupt the request that is being handled.
  }
}