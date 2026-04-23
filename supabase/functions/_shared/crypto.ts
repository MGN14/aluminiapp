// AES-GCM helpers for encrypting per-user secrets at rest.
// Master key comes from the SIIGO_ENCRYPTION_KEY Supabase secret —
// 32 raw bytes, base64-encoded (so a 44-char string with =).
//
// Format on disk:  base64( iv(12 bytes) || ciphertext+tag )

const KEY_ENV = "SIIGO_ENCRYPTION_KEY";

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get(KEY_ENV);
  if (!raw) throw new Error(`Missing ${KEY_ENV} secret`);
  const keyBytes = b64decode(raw);
  if (keyBytes.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to 32 bytes (got ${keyBytes.length})`);
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptSecret(payload: string): Promise<string> {
  const key = await getKey();
  const bytes = b64decode(payload);
  if (bytes.length < 13) throw new Error("Ciphertext too short");
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
