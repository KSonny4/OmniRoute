import { runWithProxyContext } from "../../../utils/proxyFetch.ts";

const META_API_KEY_MINT_URL = "https://api.meta.ai/muse-code/key";
const META_API_VERSION = "1.0.0";
const META_API_KEY_TTL_SECONDS = 24 * 60 * 60;

export async function refreshMetaModelApiToken(identityToken, log, proxyConfig: unknown = null) {
  try {
    const response = await runWithProxyContext(proxyConfig, () =>
      fetch(META_API_KEY_MINT_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${identityToken}`,
          "Content-Type": "application/json",
          "x-api-version": META_API_VERSION,
        },
        body: "{}",
      })
    );

    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}

    if (!response.ok) {
      const errorCode =
        typeof data?.error === "string"
          ? data.error
          : data?.error?.code || data?.code || `http_${response.status}`;
      if (response.status === 401 || response.status === 403) {
        log?.error?.(
          "TOKEN_REFRESH",
          "Meta identity token is no longer authorised. Re-authentication required.",
          { status: response.status, errorCode }
        );
        return { error: "unrecoverable_refresh_error", code: errorCode };
      }
      log?.error?.("TOKEN_REFRESH", "Failed to re-mint Meta Model API key", {
        status: response.status,
        error: text,
      });
      return null;
    }

    const apiKey = typeof data?.api_key === "string" ? data.api_key.trim() : "";
    if (!apiKey) {
      log?.error?.("TOKEN_REFRESH", "Meta key mint response contained no api_key");
      return null;
    }

    return {
      accessToken: apiKey,
      refreshToken: identityToken,
      expiresIn: META_API_KEY_TTL_SECONDS,
    };
  } catch (error) {
    log?.error?.(
      "TOKEN_REFRESH",
      `Network error re-minting Meta Model API key: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
