import { Router } from "express";

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
    const googleResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
    );
    if (!googleResponse.ok) {
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
    console.error("[Auth] Erro ao validar login do Google:", error);
    res.status(502).json({ error: "O serviço do Google não respondeu." });
  }
});

export default router;