import { Router } from "express";
import * as argon2 from "argon2";
import { prisma } from "./prisma";
import { Prisma } from "./generated/prisma/client";
import { createAccessToken, hashToken, randomToken } from "./tokens";
import { emailInput, passwordInput, tokenInput, HttpError } from "./validation";
import { authenticate } from "./middlewares/auth";
import { rateLimit } from "./middlewares/rate-limit";
import { sendEmail, actionLink } from "./email";

export const authRouter = Router();
authRouter.use(rateLimit());
authRouter.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

// Verrouiller le compte évite de créer une session pendant sa désactivation.
export async function lockUser(tx: Prisma.TransactionClient, id: number) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
}
const publicUser = { id: true, email: true, role: true, isActive: true } as const;
const badCredentials = () => new HttpError(401, "Email ou mot de passe incorrect.");
const invalidAction = () => new HttpError(400, "Lien invalide, expiré ou déjà utilisé.");

authRouter.post("/login", async (req, res) => {
  const email = emailInput(req.body?.email);
  const password = req.body?.password;
  if (typeof password !== "string" || !password || password.length > 128) throw badCredentials();
  const user = await prisma.user.findUnique({ where: { email } });
  // Calcul Argon2 aussi pour un compte absent : évite une réponse immédiatement différente.
  const valid = user?.passwordHash
    ? await argon2.verify(user.passwordHash, password)
    : (await argon2.hash(password), false);
  if (!user || !valid || !user.isActive) throw badCredentials();
  const refreshToken = randomToken();
  const session = await prisma.$transaction(async tx => {
    await lockUser(tx, user.id);
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!current.isActive || current.passwordHash !== user.passwordHash) throw badCredentials();
    return tx.session.create({
      data: {
        userId: user.id, expiresAt: new Date(Date.now() + 7 * 86400000),
        refreshTokens: { create: { tokenHash: hashToken(refreshToken) } }
      }
    });
  });
  res.json({ accessToken: createAccessToken(user.id, session.id), refreshToken,
    tokenType: "Bearer", expiresIn: 900 });
});

authRouter.post("/refresh", async (req, res) => {
  const tokenHash = hashToken(tokenInput(req.body?.refreshToken));
  const previous = await prisma.refreshToken.findUnique({
    where: { tokenHash }, include: { session: true }
  });
  if (!previous) throw new HttpError(401, "Session invalide.");
  const refreshToken = randomToken();
  const session = await prisma.$transaction(async tx => {
    await lockUser(tx, previous.session.userId);
    const current = await tx.refreshToken.findUniqueOrThrow({
      where: { tokenHash }, include: { session: { include: { user: true } } }
    });
    if (current.usedAt) {
      // La réutilisation d'un ancien jeton révoque toute la session.
      await tx.session.update({ where: { id: current.sessionId }, data: { revokedAt: new Date() } });
      return null;
    }
    if (current.session.revokedAt || current.session.expiresAt <= new Date() || !current.session.user.isActive)
      return null;
    await tx.refreshToken.update({ where: { id: current.id }, data: { usedAt: new Date() } });
    await tx.refreshToken.create({ data: { sessionId: current.sessionId, tokenHash: hashToken(refreshToken) } });
    return current.session;
  });
  if (!session) throw new HttpError(401, "Session invalide. Reconnecte-toi.");
  res.json({ accessToken: createAccessToken(session.userId, session.id), refreshToken,
    tokenType: "Bearer", expiresIn: 900 });
});

authRouter.post("/logout", async (req, res) => {
  const tokenHash = hashToken(tokenInput(req.body?.refreshToken));
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { session: true } });
  if (token) {
    await prisma.$transaction(async tx => {
      await lockUser(tx, token.session.userId);
      await tx.session.update({ where: { id: token.sessionId }, data: { revokedAt: new Date() } });
    });
  }
  res.status(204).send();
});

authRouter.get("/me", authenticate, (_req, res) => res.json(res.locals.user));

authRouter.post("/accept-invitation", async (req, res) => {
  const tokenHash = hashToken(tokenInput(req.body?.token));
  const passwordHash = await argon2.hash(passwordInput(req.body?.password), { type: argon2.argon2id });
  const token = await prisma.actionToken.findUnique({ where: { tokenHash } });
  if (!token) throw invalidAction();
  await prisma.$transaction(async tx => {
    await lockUser(tx, token.userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
    if (user.acceptedAt) throw invalidAction();
    const consumed = await tx.actionToken.updateMany({
      where: { id: token.id, purpose: "INVITATION", usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) throw invalidAction();
    await tx.user.update({
      where: { id: user.id }, data: { passwordHash, isActive: true, acceptedAt: new Date() }
    });
    await tx.actionToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  });
  res.json({ message: "Invitation acceptée. Tu peux te connecter." });
});

authRouter.post("/forgot-password", async (req, res) => {
  const email = emailInput(req.body?.email);
  const started = Date.now();
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.isActive && user.acceptedAt) {
    const rawToken = randomToken();
    const token = await prisma.$transaction(async tx => {
      await lockUser(tx, user.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!current.isActive) return null;
      await tx.actionToken.updateMany({
        where: { userId: user.id, purpose: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() }
      });
      return tx.actionToken.create({ data: {
        userId: user.id, purpose: "PASSWORD_RESET", tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 30 * 60000)
      } });
    });
    if (token) {
      try {
        await sendEmail(user.email, "Réinitialisation du mot de passe",
          "Choisis un nouveau mot de passe (lien valable 30 minutes) : " + actionLink("/reset-password", rawToken));
      } catch {
        await prisma.actionToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
        console.error("Échec de l'envoi d'un email de réinitialisation.");
      }
    }
  }
  // Même message et délai minimum, que le compte existe ou non.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 800 - (Date.now() - started))));
  res.json({ message: "Si le compte peut être utilisé, un email de réinitialisation sera envoyé." });
});

authRouter.post("/reset-password", async (req, res) => {
  const tokenHash = hashToken(tokenInput(req.body?.token));
  const passwordHash = await argon2.hash(passwordInput(req.body?.password), { type: argon2.argon2id });
  const token = await prisma.actionToken.findUnique({ where: { tokenHash } });
  if (!token) throw invalidAction();
  const user = await prisma.$transaction(async tx => {
    await lockUser(tx, token.userId);
    const current = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
    if (!current.isActive || !current.acceptedAt) throw invalidAction();
    const consumed = await tx.actionToken.updateMany({
      where: { id: token.id, purpose: "PASSWORD_RESET", usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) throw invalidAction();
    await tx.user.update({ where: { id: current.id }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: current.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.actionToken.updateMany({ where: { userId: current.id, usedAt: null }, data: { usedAt: new Date() } });
    return current;
  });
  try { await sendEmail(user.email, "Mot de passe modifié", "Ton mot de passe a été modifié. Reconnecte-toi avec le nouveau."); }
  catch { console.error("Échec de l'email de confirmation."); }
  res.json({ message: "Mot de passe modifié. Toutes les sessions ont été fermées." });
});

