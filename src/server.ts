import "dotenv/config";
import { app } from "./app";
import { prisma } from "./prisma";
async function main() {
  await prisma.$connect();
  const server = app.listen(3000, () => console.log("Server is running on port 3000"));
  server.on("error", () => {
    console.error("Impossible de démarrer le serveur. Vérifie que le port 3000 est libre.");
    void prisma.$disconnect().finally(() => { process.exitCode = 1; });
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      const timer = setTimeout(() => process.exit(1), 10000);
      timer.unref();
      server.close(() => { void prisma.$disconnect().finally(() => process.exit(0)); });
    });
  }
}
void main().catch(() => {
  console.error("Impossible de se connecter à PostgreSQL. Vérifie DATABASE_URL et le service PostgreSQL.");
  void prisma.$disconnect().finally(() => { process.exitCode = 1; });
});
