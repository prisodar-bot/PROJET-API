import * as argon2 from "argon2";
import { prisma } from "./prisma";

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password || password.length < 16) {
    throw new Error(
      "Renseigne SUPER_ADMIN_EMAIL et un mot de passe d'au moins 16 caractères."
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    throw new Error("Un utilisateur possède déjà cette adresse email.");
  }

  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" }
  });

  if (existingSuperAdmin) {
    throw new Error("Le premier Super Admin existe déjà.");
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id
  });

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
      acceptedAt: new Date()
    }
  });

  console.log("Premier Super Admin créé.");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });