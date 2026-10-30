import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// En développement, les emails sont enregistrés localement sans envoi réel.
export async function sendEmail(to: string, subject: string, text: string) {
  const provider = process.env.EMAIL_PROVIDER ?? "local";
  if (provider === "local" && process.env.NODE_ENV !== "production") {
    const directory = process.env.EMAIL_LOCAL_DIR ?? join(process.cwd(), ".local-emails");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, Date.now() + "-" + randomUUID() + ".json"),
      JSON.stringify({ to, subject, text }, null, 2), { mode: 0o600 });
    return;
  }
  if (provider !== "resend" || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    throw new Error("Configurer EMAIL_PROVIDER=resend, RESEND_API_KEY et EMAIL_FROM.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("Envoi email refusé (" + response.status + ").");
}
export function actionLink(path: string, token: string) {
  const url = new URL(path, process.env.APP_URL ?? "http://localhost:3000");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("APP_URL doit utiliser HTTPS en production.");
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}
