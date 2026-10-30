export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function emailInput(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    throw new HttpError(400, "Adresse email invalide.");
  return value.trim().toLowerCase();
}
export function passwordInput(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 128)
    throw new HttpError(400, "Le mot de passe doit contenir entre 16 et 128 caractères.");
  return value;
}
export function tokenInput(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new HttpError(400, "Jeton invalide.");
  return value;
}
export function idInput(value: unknown): number {
  const id = Number(value);
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isInteger(id) || id > 2147483647)
    throw new HttpError(400, "Numéro invalide.");
  return id;
}
