import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
  buildMongoQueryMessages,
  DEFAULT_AI_QUERY_SETTINGS,
  isLocalAiEndpoint,
  normalizeAiEndpoint,
  parseGeneratedMongoQuery,
} from "../shared/ai-query.js";
import { isPlainRecord, validateText } from "./database/validation";
import { getOwnedConnection } from "./database";
import { getMongoCollectionDetails } from "./database/mongo";
import { assertAllowedSender } from "./database/worker-bridge";

const FILE_NAME = "ai-query-settings.json";
const MAX_PROMPT_LENGTH = 3_000;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1_024;

function validatePrompt(value) {
  if (typeof value !== "string") throw new Error("Prompt must be text.");
  const prompt = value.trim();
  if (
    !prompt ||
    prompt.length > MAX_PROMPT_LENGTH ||
    /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(prompt)
  ) {
    throw new Error("Prompt is required and must be under 3,000 characters.");
  }
  return prompt;
}

function storagePath() {
  return path.join(app.getPath("userData"), FILE_NAME);
}

async function hasSecureStorage() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
  if (process.platform !== "linux") return true;
  return ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
    safeStorage.getSelectedStorageBackend(),
  );
}

async function readStoredSettings() {
  try {
    const value = JSON.parse(await readFile(storagePath(), "utf8"));
    if (
      value?.version !== 1 ||
      typeof value.endpoint !== "string" ||
      typeof value.model !== "string" ||
      typeof value.enabled !== "boolean" ||
      (value.encryptedApiKey !== null &&
        typeof value.encryptedApiKey !== "string")
    ) {
      throw new Error("Stored AI query settings have an unsupported format.");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        version: 1,
        ...DEFAULT_AI_QUERY_SETTINGS,
        encryptedApiKey: null,
      };
    }
    throw error instanceof Error
      ? error
      : new Error("Could not read AI query settings.");
  }
}

async function writeStoredSettings(value) {
  const file = storagePath();
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, file);
  } catch {
    await unlink(temporaryFile).catch(() => undefined);
    throw new Error("Could not save AI query settings on this device.");
  }
}

function publicSettings(value) {
  const endpoint = normalizeAiEndpoint(value.endpoint);
  const model = validateText(value.model, "Model", 160, true);
  const hasApiKey = Boolean(value.encryptedApiKey);
  const needsKey = !isLocalAiEndpoint(endpoint);
  return {
    endpoint,
    model,
    enabled: value.enabled,
    hasApiKey,
    configured: value.enabled && (!needsKey || hasApiKey),
  };
}

export async function getAiQuerySettings(event) {
  assertAllowedSender(event.sender);
  return publicSettings(await readStoredSettings());
}

export async function saveAiQuerySettings(event, rawValue) {
  assertAllowedSender(event.sender);
  if (!isPlainRecord(rawValue)) throw new Error("Invalid AI query settings.");
  const current = await readStoredSettings();
  const endpoint = normalizeAiEndpoint(rawValue.endpoint);
  const model = validateText(rawValue.model, "Model", 160, true);
  if (typeof rawValue.enabled !== "boolean")
    throw new Error("Choose whether AI query generation is enabled.");
  if (
    rawValue.clearApiKey !== undefined &&
    typeof rawValue.clearApiKey !== "boolean"
  )
    throw new Error("API key removal selection is invalid.");
  let encryptedApiKey = rawValue.clearApiKey ? null : current.encryptedApiKey;
  if (rawValue.apiKey !== undefined) {
    if (
      typeof rawValue.apiKey !== "string" ||
      rawValue.apiKey.length > 4_096 ||
      /[\0\r\n]/.test(rawValue.apiKey)
    ) {
      throw new Error("API key is invalid or too long.");
    }
    if (rawValue.apiKey) {
      if (!(await hasSecureStorage())) {
        throw new Error(
          "Secure credential storage is unavailable. Rowfish did not save the API key.",
        );
      }
      try {
        encryptedApiKey = (
          await safeStorage.encryptStringAsync(rawValue.apiKey)
        ).toString("base64");
      } catch {
        throw new Error(
          "Rowfish could not encrypt the API key with the operating-system credential store.",
        );
      }
    }
  }
  const next = {
    version: 1,
    endpoint,
    model,
    enabled: rawValue.enabled,
    encryptedApiKey,
  };
  await writeStoredSettings(next);
  return publicSettings(next);
}

async function readApiKey(value) {
  if (!value.encryptedApiKey) return "";
  if (!(await hasSecureStorage())) {
    throw new Error(
      "The operating-system credential store is unavailable, so Rowfish cannot read the saved AI API key.",
    );
  }
  try {
    const result = await safeStorage.decryptStringAsync(
      Buffer.from(value.encryptedApiKey, "base64"),
    );
    return result.result;
  } catch {
    throw new Error(
      "Rowfish could not decrypt the saved AI API key. Remove it and enter it again in Settings.",
    );
  }
}

function providerError(status) {
  if (status === 401 || status === 403)
    return "The AI provider rejected the API key. Check the key in Settings.";
  if (status === 404)
    return "The AI endpoint or model was not found. Check the endpoint and model in Settings.";
  if (status === 429)
    return "The AI provider is rate-limiting this request. Try again later.";
  return `The AI provider returned HTTP ${status}. Check its endpoint and try again.`;
}

async function readProviderPayload(response) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw new Error("The AI provider response exceeds the 256 KB limit.");
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error("The AI provider returned an unreadable response.");
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The AI provider response exceeds the 256 KB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.allocUnsafe(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The AI provider returned an unreadable response.");
  }
}

async function requestCompletion(settings, messages, maxTokens = 2_048) {
  const endpoint = normalizeAiEndpoint(settings.endpoint);
  const apiKey = await readApiKey(settings);
  if (!apiKey && !isLocalAiEndpoint(endpoint)) {
    throw new Error(
      "Add an API key for this remote provider in Settings before generating a query.",
    );
  }
  let response;
  try {
    response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        max_tokens: maxTokens,
      }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("The AI provider did not respond within 45 seconds.");
    }
    throw new Error(
      "Could not reach the configured AI provider. Check the endpoint and your network connection.",
    );
  }
  if (!response.ok) throw new Error(providerError(response.status));
  let payload;
  try {
    payload = await readProviderPayload(response);
  } catch (error) {
    if (error?.message === "The AI provider response exceeds the 256 KB limit.")
      throw error;
    throw new Error("The AI provider returned an unreadable response.");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(
      "The AI provider returned no query content. Check that the selected model supports chat completions.",
    );
  }
  return content;
}

export async function testAiQueryProvider(event) {
  assertAllowedSender(event.sender);
  const settings = await readStoredSettings();
  normalizeAiEndpoint(settings.endpoint);
  validateText(settings.model, "Model", 160, true);
  const content = await requestCompletion(
    settings,
    [
      { role: "system", content: "Reply with the single word OK." },
      { role: "user", content: "Test the provider connection." },
    ],
    8,
  );
  if (!content.trim())
    throw new Error("The AI provider returned an empty test response.");
  return { message: "The provider responded successfully." };
}

export async function generateMongoQueryWithAi(event, rawValue) {
  assertAllowedSender(event.sender);
  if (!isPlainRecord(rawValue)) throw new Error("Invalid AI query request.");
  const connectionId = validateText(
    rawValue.connectionId,
    "Connection id",
    80,
    true,
  );
  const database = validateText(
    rawValue.database,
    "MongoDB database",
    128,
    true,
  );
  const collection = validateText(
    rawValue.collection,
    "MongoDB collection",
    128,
    true,
  );
  const prompt = validatePrompt(rawValue.prompt);
  const mode = rawValue.mode;
  if (mode !== "find" && mode !== "aggregate")
    throw new Error("Choose Find or Aggregate mode.");

  const settings = await readStoredSettings();
  if (!settings.enabled)
    throw new Error(
      "AI query generation is disabled. Enable it in Settings first.",
    );
  const connection = getOwnedConnection(event, connectionId);
  if (connection.config.kind !== "mongodb")
    throw new Error("Choose a MongoDB connection to generate a MongoDB query.");
  const details = await getMongoCollectionDetails(
    event,
    connectionId,
    database,
    collection,
  );
  const fields = (details.fields ?? [])
    .filter((field) => typeof field === "string" && field.length <= 240)
    .slice(0, 200);
  const indexes = (details.indexes ?? []).slice(0, 40).map((index) => ({
    keys: typeof index.keys === "string" ? index.keys.slice(0, 2_000) : "{}",
    unique: Boolean(index.unique),
  }));
  const messages = buildMongoQueryMessages({
    prompt,
    mode,
    database,
    collection,
    fields,
    indexes,
  });
  const content = await requestCompletion(settings, messages);
  return parseGeneratedMongoQuery(content, mode);
}
