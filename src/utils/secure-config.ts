import { getStoredPassword, getStoredTotpUri, setStoredPassword, setStoredTotpUri } from "../auth/credential-store.js";
import * as path from "node:path";
import { acquireProcessLock } from "../auth/auth-lock.js";
import { normalizeTotpEnrollment } from "../auth/totp.js";
import { configStoreExists, getConfigStorePath, loadConfigStore, saveConfigStore, type ConfigStoreData } from "./config-store.js";

async function withConfigWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const release = await acquireProcessLock(path.join(path.dirname(getConfigStorePath()), ".config-write.lock"));
  try {
    return await operation();
  } finally {
    await release();
  }
}

/** Save secrets first so a failed vault write leaves the old configuration intact. */
export async function saveSecureConfig(config: ConfigStoreData): Promise<void> {
  await withConfigWriteLock(() => saveSecureConfigUnlocked(config));
}

async function saveSecureConfigUnlocked(config: ConfigStoreData): Promise<void> {
  const { password, totpUri, ...publicConfig } = config;
  if (publicConfig.baseUrl) {
    const url = new URL(publicConfig.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("The Brightspace URL must be HTTPS without embedded credentials.");
    }
    publicConfig.baseUrl = url.origin;
  }
  // Validate before writing either secret, so malformed enrollment cannot
  // update the password and then fail halfway through setup.
  const validatedTotpUri = totpUri === undefined ? undefined
    : normalizeTotpEnrollment(totpUri, config.username ?? "");
  if (validatedTotpUri !== undefined &&
      (publicConfig.baseUrl !== "https://purdue.brightspace.com" || !config.username)) {
    throw new Error("An authenticator enrollment requires a Purdue school URL and username.");
  }
  if (password !== undefined) {
    if (!config.baseUrl || !config.username || !password) {
      throw new Error("A school URL, username, and nonempty password are required.");
    }
    await setStoredPassword(config.baseUrl, config.username, password);
    if (await getStoredPassword(config.baseUrl, config.username) !== password) {
      throw new Error("Could not verify the password in the native credential store. Configuration was preserved.");
    }
  }
  if (validatedTotpUri !== undefined) {
    await setStoredTotpUri(config.baseUrl!, config.username!, validatedTotpUri);
    if (await getStoredTotpUri(config.baseUrl!, config.username!) !== validatedTotpUri) {
      throw new Error("Could not verify the authenticator enrollment in the native credential store. Configuration was preserved.");
    }
  }
  saveConfigStore(publicConfig);
}

/** Migrate a v1 password under its own account, before resolving environment overrides. */
export async function resolveStoredPassword(
  baseUrl: string,
  username: string | undefined,
  store: ConfigStoreData | null,
): Promise<string | undefined> {
  if (store?.password !== undefined) {
    await withConfigWriteLock(async () => {
      // A setup command may have replaced this snapshot while native storage
      // was opening. Migrate only the current record under the same writer lock.
      const current = configStoreExists() ? loadConfigStore() : null;
      if (current?.password !== undefined) await saveSecureConfigUnlocked(current);
    });
  }
  if (!username) return undefined;
  if (process.env.D2L_PASSWORD) {
    // Environment input is supported, but the application never copies it to a file.
    await setStoredPassword(baseUrl, username, process.env.D2L_PASSWORD);
  }
  return (await getStoredPassword(baseUrl, username)) ?? undefined;
}
