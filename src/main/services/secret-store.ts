// Generic secret store backed by Electron `safeStorage` (OS keychain on
// macOS/Windows, libsecret-backed on Linux) — no native `keytar` dependency.
//
// Secrets are written as OS-encrypted ciphertext to `<userData>/secrets/<name>.bin`
// with 0600 permissions. When OS encryption is UNAVAILABLE (e.g. a Linux box
// with no libsecret), we NEVER fall back to plaintext on disk: the value is held
// in memory for the session only, so it survives reads within the run but is
// gone after a restart (status then reports unauthenticated).
//
// This module imports electron and therefore lives ONLY in the IPC layer
// (ipc/linear.ts) — the plain-node Linear service receives a decrypted-key
// getter by injection and never imports electron, keeping it unit-testable.
// The store is never exposed to the renderer except through validating handlers.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

/** Session-only fallback when OS encryption is unavailable or a disk op fails. */
const memory = new Map<string, string>();

function secretPath(name: string): string {
  return join(app.getPath("userData"), "secrets", `${name}.bin`);
}

/** Read a secret, or `null` when none is stored. Never throws. */
export function getSecret(name: string): string | null {
  if (safeStorage.isEncryptionAvailable()) {
    const path = secretPath(name);
    if (existsSync(path)) {
      try {
        return safeStorage.decryptString(readFileSync(path));
      } catch {
        // Corrupt/undecryptable ciphertext — fall through to any in-memory value.
      }
    }
  }
  return memory.get(name) ?? null;
}

/** Persist a secret as OS-encrypted ciphertext (0600), or in memory if it can't be encrypted. */
export function setSecret(name: string, value: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const path = secretPath(name);
      mkdirSync(join(app.getPath("userData"), "secrets"), {
        recursive: true,
        mode: 0o700,
      });
      writeFileSync(path, safeStorage.encryptString(value), { mode: 0o600 });
      // Enforce 0600 even when overwriting a pre-existing, looser file.
      chmodSync(path, 0o600);
      memory.delete(name);
      return;
    } catch {
      // Disk write failed — keep in memory only; never write plaintext.
    }
  }
  memory.set(name, value);
}

/** Remove a secret from disk and memory. Best-effort; never throws. */
export function clearSecret(name: string): void {
  memory.delete(name);
  try {
    rmSync(secretPath(name), { force: true });
  } catch {
    // Already absent / unremovable — nothing to do.
  }
}
