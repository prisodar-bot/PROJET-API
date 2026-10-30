import "dotenv/config";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
const secret = process.env.JWT_ACCESS_SECRET;
if (!secret || secret.length < 32) throw new Error("JWT_ACCESS_SECRET doit contenir au moins 32 caractères.");
const key: string = secret;
export const randomToken = () => randomBytes(32).toString("hex");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export function createAccessToken(userId: number, sessionId: string) {
  return jwt.sign({ sid: sessionId }, key, {
    algorithm: "HS256", subject: String(userId), expiresIn: "15m",
    issuer: "support-api", audience: "support-api"
  });
}
export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, key, {
    algorithms: ["HS256"], issuer: "support-api", audience: "support-api"
  });
  if (typeof payload === "string" || typeof payload.sub !== "string" ||
      !/^[1-9]\d*$/.test(payload.sub) || Number(payload.sub) > 2147483647 ||
      typeof payload.sid !== "string" || typeof payload.exp !== "number")
    throw new Error("Jeton invalide");
  return { userId: Number(payload.sub), sessionId: payload.sid };
}
