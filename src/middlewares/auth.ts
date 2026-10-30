import { RequestHandler } from "express";
import { prisma } from "../prisma";
import { verifyAccessToken } from "../tokens";
import { Role } from "../generated/prisma/enums";

export const authenticate: RequestHandler = async (req, res, next) => {
  const match = req.headers.authorization?.match(/^Bearer (\S+)$/i);
  if (!match) { res.status(401).json({ error: "Authentification requise." }); return; }
  let identity;
  try { identity = verifyAccessToken(match[1]); }
  catch { res.status(401).json({ error: "Jeton invalide ou expiré." }); return; }
  const session = await prisma.session.findUnique({
    where: { id: identity.sessionId },
    include: { user: { select: { id: true, email: true, role: true, isActive: true } } }
  });
  if (!session || session.userId !== identity.userId || session.revokedAt ||
      session.expiresAt <= new Date() || !session.user.isActive) {
    res.status(401).json({ error: "Session ou compte indisponible." }); return;
  }
  res.locals.user = session.user;
  res.locals.sessionId = session.id;
  next();
};

export function allowRoles(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    if (!res.locals.user || !roles.includes(res.locals.user.role)) {
      res.status(403).json({ error: "Permissions insuffisantes." }); return;
    }
    next();
  };
}
