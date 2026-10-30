import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as argon2 from "argon2";
import { app } from "../src/app";
import { prisma } from "../src/prisma";
import { createAccessToken, hashToken, randomToken } from "../src/tokens";

// Comptes de test uniques, supprimés à la fin. Aucun compte existant n'est modifié.
test("parcours complets : rôles, invitations, sessions, reset et comptes", async () => {
  const prefix = "test-" + randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "support-api-"));
  process.env.EMAIL_PROVIDER = "local";
  process.env.EMAIL_LOCAL_DIR = directory;
  const password = "Mot-de-passe-de-test-12345";
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port introuvable");
  const base = "http://127.0.0.1:" + address.port;

  async function call(method: string, path: string, body?: unknown, access?: string) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}),
        ...(access ? { Authorization: "Bearer " + access } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const result = response.status === 204 ? null : await response.json();
    return { status: response.status, body: result };
  }
  async function emailToken(email: string, subject: string) {
    for (const file of (await readdir(directory)).reverse()) {
      const message = JSON.parse(await readFile(join(directory, file), "utf8"));
      if (message.to === email && message.subject === subject) {
        const url = message.text.match(/http\S+/)?.[0];
        return new URLSearchParams(new URL(url).hash.slice(1)).get("token");
      }
    }
    throw new Error("Email de test introuvable");
  }
  async function login(email: string, pw = password) {
    const result = await call("POST", "/auth/login", { email, password: pw });
    assert.equal(result.status, 200, "connexion réussie");
    return result.body;
  }
  try {
    const admin = await prisma.user.create({ data: {
      email: prefix + "-super@example.com", role: "SUPER_ADMIN", isActive: true,
      acceptedAt: new Date(), passwordHash: await argon2.hash(password)
    } });
    const superSession = await login(admin.email);
    const superAccess = superSession.accessToken;
    assert.equal((await call("GET", "/tickets")).status, 401);
    assert.equal((await call("POST", "/auth/login", { email: admin.email, password: "incorrect" })).status, 401);
    const roles = ["USER", "AGENT", "ADMIN"] as const;
    const accounts: Record<string, any> = {};
    for (const role of roles) {
      const email = prefix + "-" + role.toLowerCase() + "@example.com";
      const created = await call("POST", "/users", { email, role }, superAccess);
      assert.equal(created.status, 201);
      assert.equal(created.body.passwordHash, undefined);
      assert.equal((await call("POST", "/auth/login", { email, password })).status, 401);
      const token = await emailToken(email, "Invitation au support informatique");
      const accept = await call("POST", "/auth/accept-invitation", { token, password });
      assert.equal(accept.status, 200);
      assert.equal((await call("POST", "/auth/accept-invitation", { token, password })).status, 400);
      accounts[role] = { id: created.body.id, email, ...(await login(email)) };
    }
    const user = accounts.USER, agent = accounts.AGENT, manager = accounts.ADMIN;
    assert.equal((await call("POST", "/users", { email: prefix + "-no@example.com" }, user.accessToken)).status, 403);
    assert.equal((await call("POST", "/users", { email: prefix + "-no@example.com" }, manager.accessToken)).status, 403);
    assert.equal((await call("GET", "/users", undefined, manager.accessToken)).status, 200);
    assert.equal((await call("GET", "/users", undefined, agent.accessToken)).status, 403);
    const own = await call("POST", "/tickets", { title: "Test", description: "Ticket utilisateur" }, user.accessToken);
    const other = await call("POST", "/tickets", { title: "Test", description: "Ticket super admin" }, superAccess);
    assert.equal(own.status, 201);
    assert.equal(own.body.createdById, user.id);
    const list = await call("GET", "/tickets", undefined, user.accessToken);
    assert.ok(list.body.every((ticket: any) => ticket.createdById === user.id));
    assert.equal((await call("GET", "/tickets/" + other.body.id, undefined, user.accessToken)).status, 404);
    assert.equal((await call("GET", "/tickets/" + own.body.id, undefined, user.accessToken)).status, 200);
    assert.equal((await call("PATCH", "/tickets/" + own.body.id + "/status", { status: "RESOLVED" }, user.accessToken)).status, 403);
    assert.equal((await call("PATCH", "/tickets/" + own.body.id + "/status", { status: "RESOLVED" }, agent.accessToken)).status, 200);
    assert.equal((await call("GET", "/tickets/abc", undefined, superAccess)).status, 400);

    const rotated = await call("POST", "/auth/refresh", { refreshToken: user.refreshToken });
    assert.equal(rotated.status, 200);
    assert.ok(rotated.body.refreshToken !== user.refreshToken);
    assert.equal((await call("POST", "/auth/refresh", { refreshToken: user.refreshToken })).status, 401);
    assert.equal((await call("GET", "/auth/me", undefined, rotated.body.accessToken)).status, 401);
    const logoutSession = await login(user.email);
    assert.equal((await call("POST", "/auth/logout", { refreshToken: logoutSession.refreshToken })).status, 204);
    assert.equal((await call("POST", "/auth/refresh", { refreshToken: logoutSession.refreshToken })).status, 401);
    assert.equal((await call("GET", "/tickets", undefined, logoutSession.accessToken)).status, 401);

    const beforeReset = await login(user.email);
    const forgot = await call("POST", "/auth/forgot-password", { email: user.email });
    const absent = await call("POST", "/auth/forgot-password", { email: prefix + "-absent@example.com" });
    assert.deepEqual(forgot, absent);
    const resetToken = await emailToken(user.email, "Réinitialisation du mot de passe");
    const newPassword = password + "-nouveau";
    assert.equal((await call("POST", "/auth/reset-password", { token: resetToken, password: newPassword })).status, 200);
    assert.equal((await call("POST", "/auth/reset-password", { token: resetToken, password: newPassword })).status, 400);
    assert.equal((await call("GET", "/auth/me", undefined, beforeReset.accessToken)).status, 401);
    assert.equal((await call("POST", "/auth/login", { email: user.email, password })).status, 401);
    const newSession = await login(user.email, newPassword);
    assert.equal((await call("PATCH", "/users/" + user.id + "/active", { isActive: false }, superAccess)).status, 200);
    assert.equal((await call("GET", "/auth/me", undefined, newSession.accessToken)).status, 401);
    assert.equal((await call("POST", "/auth/refresh", { refreshToken: newSession.refreshToken })).status, 401);
    assert.equal((await call("POST", "/auth/login", { email: user.email, password: newPassword })).status, 401);
    assert.equal((await call("PATCH", "/users/" + user.id + "/active", { isActive: true }, superAccess)).status, 200);
    await login(user.email, newPassword);
    assert.equal((await call("GET", "/auth/me", undefined, newSession.accessToken)).status, 401);

    const expiredRaw = randomToken();
    await prisma.actionToken.create({ data: {
      userId: user.id, tokenHash: hashToken(expiredRaw), purpose: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() - 1000)
    } });
    assert.equal((await call("POST", "/auth/reset-password", { token: expiredRaw, password: newPassword })).status, 400);
    const expiredSession = await prisma.session.create({ data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await call("GET", "/auth/me", undefined, createAccessToken(user.id, expiredSession.id))).status, 401);
    const race = await login(agent.email);
    const results = await Promise.all([
      call("POST", "/auth/refresh", { refreshToken: race.refreshToken }),
      call("POST", "/auth/refresh", { refreshToken: race.refreshToken })
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
    const winner = results.find(result => result.status === 200)!;
    assert.equal((await call("GET", "/auth/me", undefined, winner.body.accessToken)).status, 401);
    assert.equal((await call("PATCH", "/users/" + agent.id + "/role", { role: "USER" }, superAccess)).status, 200);
    assert.equal((await call("PATCH", "/tickets/" + own.body.id + "/status", { status: "OPEN" }, agent.accessToken)).status, 403);
    assert.equal((await call("PATCH", "/users/" + admin.id + "/active", { isActive: false }, superAccess)).status, 400);
    const pending = await call("POST", "/users", { email: prefix + "-pending@example.com" }, superAccess);
    assert.equal(pending.status, 201);
    const firstInvite = await emailToken(pending.body.email, "Invitation au support informatique");
    assert.equal((await call("POST", "/users/" + pending.body.id + "/invitation", {}, superAccess)).status, 200);
    assert.equal((await call("POST", "/auth/accept-invitation", { token: firstInvite, password })).status, 400);
    const latestInvite = await emailToken(pending.body.email, "Invitation au support informatique");
    await prisma.actionToken.update({ where: { tokenHash: hashToken(latestInvite!) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await call("POST", "/auth/accept-invitation", { token: latestInvite, password })).status, 400);
    const malformed = await fetch(base + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"email":'
    });
    assert.equal(malformed.status, 400);
    console.log("Permissions, invitations, rotation/rejeu, déconnexion, reset et désactivation : OK.");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const users = await prisma.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
    const ids = users.map(user => user.id);
    await prisma.refreshToken.deleteMany({ where: { session: { userId: { in: ids } } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.actionToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.ticket.deleteMany({ where: { createdById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
