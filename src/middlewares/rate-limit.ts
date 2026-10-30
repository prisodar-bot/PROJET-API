import { RequestHandler } from "express";

// Limite simple par adresse IP, pour un serveur unique.
export function rateLimit(maximum = 30, duration = 15 * 60 * 1000): RequestHandler {
  const visits = new Map<string, { count: number; until: number }>();
  const cleanup = setInterval(() => {
    for (const [key, value] of visits) if (value.until <= Date.now()) visits.delete(key);
  }, duration);
  cleanup.unref();
  return (req, res, next) => {
    const key = (req.ip ?? "unknown") + ":" + req.path;
    let entry = visits.get(key);
    if (!entry || entry.until <= Date.now()) {
      entry = { count: 0, until: Date.now() + duration };
      visits.set(key, entry);
    }
    if (++entry.count > maximum) {
      res.set("Retry-After", String(Math.ceil((entry.until - Date.now()) / 1000)));
      res.status(429).json({ error: "Trop de tentatives. Réessaye plus tard." }); return;
    }
    next();
  };
}
