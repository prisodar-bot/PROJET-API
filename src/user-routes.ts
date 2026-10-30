import { Router } from "express";
import { prisma } from "./prisma";
import { authenticate, allowRoles } from "./middlewares/auth";
import { emailInput, idInput, HttpError } from "./validation";
import { Role } from "./generated/prisma/enums";
import { hashToken, randomToken } from "./tokens";
import { sendEmail, actionLink } from "./email";
import { lockUser } from "./auth-routes";

export const userRouter = Router();
userRouter.use(authenticate);
const fields = { id: true, email: true, role: true, isActive: true, acceptedAt: true, createdAt: true } as const;

async function invite(userId: number, email: string) {
  const token = randomToken();
  const stored = await prisma.$transaction(async tx => {
    await lockUser(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.acceptedAt) throw new HttpError(409, "Ce compte a déjà accepté son invitation.");
    await tx.actionToken.updateMany({
      where: { userId, purpose: "INVITATION", usedAt: null }, data: { usedAt: new Date() }
    });
    await tx.user.update({ where: { id: userId }, data: { invitedAt: new Date() } });
    return tx.actionToken.create({ data: {
      userId, purpose: "INVITATION", tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 24 * 3600000)
    } });
  });
  try {
    await sendEmail(email, "Invitation au support informatique",
      "Choisis ton mot de passe (lien valable 24 heures) : " + actionLink("/accept-invitation", token));
  } catch {
    await prisma.actionToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
    throw new HttpError(502, "Compte conservé mais invitation non envoyée. Utilise la route de renvoi.");
  }
}

userRouter.get("/", allowRoles("SUPER_ADMIN", "ADMIN"), async (_req, res) => {
  res.json(await prisma.user.findMany({ select: fields, orderBy: { id: "asc" } }));
});
userRouter.post("/", allowRoles("SUPER_ADMIN"), async (req, res) => {
  const email = emailInput(req.body?.email);
  const role = req.body?.role ?? "USER";
  if (!Object.values(Role).includes(role)) throw new HttpError(400, "Rôle invalide.");
  const user = await prisma.user.create({ data: { email, role }, select: fields });
  await invite(user.id, email);
  res.status(201).json(user);
});
userRouter.post("/:id/invitation", allowRoles("SUPER_ADMIN"), async (req, res) => {
  const id = idInput(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, "Utilisateur introuvable.");
  await invite(id, user.email);
  res.json({ message: "Invitation envoyée. Les invitations précédentes sont invalidées." });
});
userRouter.patch("/:id/active", allowRoles("SUPER_ADMIN"), async (req, res) => {
  const id = idInput(req.params.id);
  const isActive = req.body?.isActive;
  if (typeof isActive !== "boolean") throw new HttpError(400, "isActive doit être true ou false.");
  if (id === res.locals.user.id) throw new HttpError(400, "Tu ne peux pas modifier ton propre état.");
  const user = await prisma.$transaction(async tx => {
    await lockUser(tx, id);
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, "Utilisateur introuvable.");
    if (isActive && !target.acceptedAt) throw new HttpError(409, "Le compte doit d'abord accepter une invitation.");
    const updated = await tx.user.update({ where: { id }, data: { isActive }, select: fields });
    if (!isActive) {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.actionToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    }
    return updated;
  });
  res.json(user);
});
userRouter.patch("/:id/role", allowRoles("SUPER_ADMIN"), async (req, res) => {
  const id = idInput(req.params.id);
  const role = req.body?.role;
  if (!Object.values(Role).includes(role)) throw new HttpError(400, "Rôle invalide.");
  if (id === res.locals.user.id) throw new HttpError(400, "Tu ne peux pas modifier ton propre rôle.");
  res.json(await prisma.user.update({ where: { id }, data: { role }, select: fields }));
});
