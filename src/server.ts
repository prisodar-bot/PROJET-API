import { prisma } from "./prisma";
import express from "express";

const app = express();
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Hello, World!");
});
app.get("/tickets", async (req, res) => {
  try {
    const tickets = await prisma.ticket.findMany();
    res.json(tickets);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Impossible de récupérer les tickets."
    });
  }
});
app.post("/tickets", async (req, res) => {
  const { title, description } = req.body ?? {};

  if (
    typeof title !== "string" ||
    typeof description !== "string" ||
    title.trim() === "" ||
    description.trim() === ""
  ) {
    res.status(400).json({
      error: "Le titre et la description sont obligatoires."
    });
    return;
  }

  try {
    const ticket = await prisma.ticket.create({
      data: {
        title: title.trim(),
        description: description.trim()
      }
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Impossible de créer le ticket."
    });
  }
});
app.get("/tickets/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    res.status(400).json({
      error: "Le numéro du ticket doit être un entier positif valide."
    });
    return;
  }

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id }
    });

    if (!ticket) {
      res.status(404).json({
        error: "Ticket introuvable."
      });
      return;
    }

    res.json(ticket);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Impossible de récupérer le ticket."
    });
  }
});
app.patch("/tickets/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};

  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    res.status(400).json({
      error: "Numéro de ticket invalide."
    });
    return;
  }

  const allowedStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

  if (typeof status !== "string" || !allowedStatuses.includes(status)) {
    res.status(400).json({
      error: "Statut accepté : OPEN, IN_PROGRESS, RESOLVED ou CLOSED."
    });
    return;
  }

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id }
    });

    if (!ticket) {
      res.status(404).json({
        error: "Ticket introuvable."
      });
      return;
    }

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: { status }
    });

    res.json(updatedTicket);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Impossible de modifier le statut."
    });
  }
});
app.listen(3000, () => {
  console.log("Server is running on port 3000");
});