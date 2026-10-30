import express, { ErrorRequestHandler } from "express";
import { Prisma } from "./generated/prisma/client";
import { authRouter } from "./auth-routes";
import { userRouter } from "./user-routes";
import { ticketRouter } from "./ticket-routes";
import { actionPages } from "./action-pages";
import { HttpError } from "./validation";
export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.get("/", (_req, res) => res.send("API de support informatique"));
app.use(actionPages);
app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/tickets", ticketRouter);
app.use((_req, res) => res.status(404).json({ error: "Route introuvable." }));
const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { res.status(409).json({ error: "Cette adresse email existe déjà." }); return; }
    if (error.code === "P2025") { res.status(404).json({ error: "Ressource introuvable." }); return; }
  }
  if (error?.type === "entity.parse.failed") { res.status(400).json({ error: "Le corps doit être un JSON valide." }); return; }
  if (error?.type === "entity.too.large") { res.status(413).json({ error: "Corps de requête trop volumineux." }); return; }
  console.error("Erreur interne :", error?.name ?? "inconnue");
  res.status(500).json({ error: "Erreur interne du serveur." });
};
app.use(handleError);
