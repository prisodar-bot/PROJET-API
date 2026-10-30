import { Router } from "express";
import { prisma } from "./prisma";
import { authenticate, allowRoles } from "./middlewares/auth";
import { HttpError, idInput } from "./validation";
export const ticketRouter = Router();
ticketRouter.use(authenticate);
ticketRouter.get("/", async (_req, res) => {
  const user = res.locals.user;
  res.json(await prisma.ticket.findMany({
    where: user.role === "USER" ? { createdById: user.id } : {}, orderBy: { id: "asc" }
  }));
});
ticketRouter.post("/", async (req, res) => {
  const { title, description } = req.body ?? {};
  if (typeof title !== "string" || !title.trim() || title.length > 150 ||
      typeof description !== "string" || !description.trim() || description.length > 10000)
    throw new HttpError(400, "Titre (1 à 150 caractères) et description (1 à 10 000 caractères) requis.");
  const ticket = await prisma.ticket.create({ data: {
    title: title.trim(), description: description.trim(), createdById: res.locals.user.id
  } });
  res.status(201).json(ticket);
});
ticketRouter.get("/:id", async (req, res) => {
  const id = idInput(req.params.id);
  const user = res.locals.user;
  const ticket = await prisma.ticket.findFirst({
    where: { id, ...(user.role === "USER" ? { createdById: user.id } : {}) }
  });
  if (!ticket) throw new HttpError(404, "Ticket introuvable.");
  res.json(ticket);
});
ticketRouter.patch("/:id/status", allowRoles("SUPER_ADMIN", "ADMIN", "AGENT"), async (req, res) => {
  const id = idInput(req.params.id);
  const status = req.body?.status;
  if (typeof status !== "string" || !["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status))
    throw new HttpError(400, "Statut accepté : OPEN, IN_PROGRESS, RESOLVED ou CLOSED.");
  res.json(await prisma.ticket.update({ where: { id }, data: { status } }));
});
