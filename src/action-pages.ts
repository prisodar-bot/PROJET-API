import { Router } from "express";
export const actionPages = Router();
// Pages minimales pour utiliser les liens d'email sans application frontend.
for (const action of ["accept-invitation", "reset-password"]) {
  actionPages.get("/" + action, (_req, res) => {
    res.set("Referrer-Policy", "no-referrer");
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.type("html").send(`<!doctype html>
<html lang="fr"><meta charset="utf-8"><title>Choisir un mot de passe</title>
<h1>Choisir un mot de passe</h1>
<form id="form">
<label>Nouveau mot de passe (16 à 128 caractères)
<input id="password" type="password" minlength="16" maxlength="128" autocomplete="new-password" required></label>
<label>Confirmation
<input id="confirmation" type="password" minlength="16" maxlength="128" autocomplete="new-password" required></label>
<button>Enregistrer</button></form><p id="message" role="status"></p>
<script>
const token = new URLSearchParams(location.hash.slice(1)).get("token");
history.replaceState(null, "", location.pathname);
const form = document.getElementById("form");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("message");
  const password = document.getElementById("password").value;
  if (password !== document.getElementById("confirmation").value) {
    message.textContent = "Les mots de passe sont différents."; return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/auth/${action}", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });
    const result = await response.json();
    message.textContent = result.message || result.error;
    if (response.ok) form.hidden = true;
  } catch { message.textContent = "Impossible de joindre le serveur."; }
  finally { button.disabled = false; }
});
</script></html>`);
  });
}
