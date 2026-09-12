import { resolvePublicCred } from "@omniroute/open-sse/utils/publicCreds.ts";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const MODEL_API_KEY_TTL_SECONDS = 24 * 60 * 60;

export const META_MODEL_API_CONFIG = {
  clientId: resolvePublicCred("meta_model_api_id", "META_OAUTH_CLIENT_ID"),
  deviceCodeUrl: "https://auth.meta.com/oidc/device/authorization/",
  tokenUrl: "https://auth.meta.com/oidc/device/token/",
  apiKeyMintUrl: "https://api.meta.ai/muse-code/key",
  apiVersion: "1.0.0",
};

type JsonRecord = Record<string, any>;

async function readJson(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function errorDetail(data: JsonRecord, fallback: string): string {
  for (const value of [
    data.error_description,
    data.detail,
    data.message,
    typeof data.error === "string" ? data.error : data.error?.message,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export async function mintMetaModelApiKey(identityToken: string): Promise<string> {
  const response = await fetch(META_MODEL_API_CONFIG.apiKeyMintUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${identityToken}`,
      "Content-Type": "application/json",
      "x-api-version": META_MODEL_API_CONFIG.apiVersion,
    },
    body: "{}",
  });
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      `Meta Model API key mint failed (HTTP ${response.status}): ${errorDetail(
        data,
        response.statusText || "unknown error"
      )}`
    );
  }

  const apiKey = typeof data.api_key === "string" ? data.api_key.trim() : "";
  if (!apiKey) {
    const setup =
      typeof data.action_url === "string" && data.action_url
        ? ` Complete setup at ${data.action_url}.`
        : "";
    throw new Error(`Meta did not issue a Model API key.${setup}`);
  }
  return apiKey;
}

export const museCodeOauth = {
  config: META_MODEL_API_CONFIG,
  flowType: "device_code" as const,

  requestDeviceCode: async (config) => {
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ client_id: config.clientId }),
    });
    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(
        `Meta device authorization failed (HTTP ${response.status}): ${errorDetail(
          data,
          response.statusText || "unknown error"
        )}`
      );
    }
    if (!data.device_code || !data.user_code || !data.verification_uri) {
      throw new Error("Meta device authorization returned an incomplete response");
    }
    return data;
  },

  pollToken: async (config, deviceCode) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        device_code: deviceCode,
        client_id: config.clientId,
      }),
    });

    return { ok: response.ok, data: await readJson(response) };
  },

  postExchange: async (tokens) => {
    const identityToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    if (!identityToken) throw new Error("Meta device flow returned no identity token");
    return { apiKey: await mintMetaModelApiKey(identityToken) };
  },

  mapTokens: (tokens, extra) => {
    const identityToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    const apiKey = typeof extra?.apiKey === "string" ? extra.apiKey : "";
    if (!identityToken || !apiKey) {
      throw new Error("Meta OAuth token mapping is missing required credentials");
    }

    return {
      accessToken: apiKey,
      refreshToken: identityToken,
      expiresIn: MODEL_API_KEY_TTL_SECONDS,
      tokenType: "Bearer",
      name: "Meta Model API",
      providerSpecificData: {
        apiVersion: META_MODEL_API_CONFIG.apiVersion,
      },
    };
  },
};
