import { Router } from "express";
import { logApiError } from "../lib/error-log";

const router = Router();

function getGoogleClientId(): string {
  return process.env.ID_DO_CLIENTE ?? process.env.GOOGLE_CLIENT_ID ?? "";
}

router.get("/google/config", (_req, res) => {
  const clientId = getGoogleClientId();
  res.json({ enabled: Boolean(clientId), clientId: clientId || null });
});

router.post("/google", async (req, res) => {
  const credential = typeof req.body?.credential === "string"
    ? req.body.credential.trim()
    : "";
  const clientId = getGoogleClientId();

  if (!clientId) {
    res.status(503).json({ error: "Login do Google não configurado no servidor." });
    return;
  }

  if (!credential || credential.length > 20_000) {
    res.status(400).json({ error: "Credencial do Google inválida." });
    return;
  }

  try {
    let googleResponse: Response;
    try {
      googleResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      );
    } catch (error) {
      logApiError("validar_token_google", error);
      res.status(502).json({ error: "O serviço do Google não respondeu." });
      return;
    }

    if (!googleResponse.ok) {
      logApiError("validar_token_google", new Error(`Google tokeninfo HTTP ${googleResponse.status}`));
      res.status(401).json({ error: "Não foi possível validar o login do Google." });
      return;
    }

    const profile = await googleResponse.json() as {
      aud?: string;
      sub?: string;
      email?: string;
      email_verified?: string;
      name?: string;
      picture?: string;
      given_name?: string;
      family_name?: string;
    };

    if (profile.aud !== clientId || !profile.sub || !profile.email) {
      res.status(401).json({ error: "A credencial não pertence a este aplicativo." });
      return;
    }

    try {
      if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL não configurado para salvar o perfil.");
      }

      const { db, usuariosTable } = await import("@workspace/db");
      const now = new Date();
      await db.insert(usuariosTable).values({
        googleSub: profile.sub,
        name: profile.name ?? profile.email.split("@")[0],
        email: profile.email,
        picture: profile.picture ?? null,
        firstLoginAt: now,
        lastLoginAt: now,
      }).onConflictDoUpdate({
        target: usuariosTable.googleSub,
        // Existing profile fields are intentionally preserved on later logins.
        set: { lastLoginAt: now },
      });
    } catch (error) {
      logApiError("salvar_perfil_usuario", error);
      res.status(503).json({ error: "Não foi possível salvar sua conta, tente novamente." });
      return;
    }

    res.json({
      id: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified === "true",
      name: profile.name ?? profile.email.split("@")[0],
      picture: profile.picture ?? null,
      givenName: profile.given_name ?? null,
      familyName: profile.family_name ?? null,
    });
  } catch (error) {
    logApiError("login_google", error);
    res.status(502).json({ error: "O serviço do Google não respondeu." });
  }
});

export default router;