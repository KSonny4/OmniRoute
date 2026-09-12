# Muse Code OAuth

OmniRoute's Muse Code integration supports Meta's OIDC device-login flow in addition to the existing direct Model API key path.

## Credential lifecycle

Meta uses two credentials for Muse Code:

1. **Meta OIDC identity token**
   - obtained from Meta's device OAuth flow;
   - durable credential used to authorise new Muse Model API keys;
   - stored by OmniRoute in the encrypted OAuth refresh-token field.

2. **Muse Model API key**
   - minted with `POST https://api.meta.ai/muse-code/key` using the identity token;
   - used as the Bearer credential for Muse inference;
   - stored as the connection access token;
   - re-minted on an approximately 24-hour cadence.

The login sequence is:

```text
POST auth.meta.com/oidc/device/authorization/
    -> device_code + user_code + verification_uri

user authorises the device

POST auth.meta.com/oidc/device/token/
    -> Meta identity token

POST api.meta.ai/muse-code/key
Authorization: Bearer <Meta identity token>
    -> Muse Model API key

Muse Responses API
Authorization: Bearer <Muse Model API key>
```

A direct API-key connection does not carry a refresh token, so it continues through the normal Muse inference path without invoking the OAuth re-mint logic.

## Prompt caching

Muse Code supports `prompt_cache_retention: "24h"` on Responses requests. OmniRoute's generic OpenAI-compatible sanitiser removes this field for compatibility with providers that reject it, so the Muse-specific executor restores it only for the `muse-code` route.

This is intentionally provider-scoped. Do not globally preserve `prompt_cache_retention` for all OpenAI-compatible providers.

## Model catalogue

The static fallback catalogue contains the current Muse Spark family used by the working reference integration:

- `muse-spark-1.3`
- `muse-spark-1.3-contributor`
- `muse-spark-1.2`
- `muse-spark-1.2-contributor`
- `muse-spark-1.1`

Meta's live `GET https://api.meta.ai/v1/models` catalogue should be preferred when model sync is available. The static list exists so startup and offline operation remain bounded and useful.

## Security and failure behaviour

- Never log or persist the Meta identity token outside OmniRoute's encrypted credential storage.
- Never commit a Model API key or device code.
- A transient re-mint failure must not immediately disable an account. OmniRoute's executor refresh contract keeps the stale credential and lets a confirmed upstream authentication failure drive the expired-account state.
- A confirmed 401/403 from Meta after refresh means the user should reconnect the Meta account.

## Reference implementation and attribution

The protocol behaviour was derived from and cross-checked against [`BlockedPath/pi-meta-oauth`](https://github.com/BlockedPath/pi-meta-oauth), which is MIT licensed. That project provides a working Meta device OAuth flow, Muse Model API-key mint/refresh behaviour, live model catalogue handling and Muse prompt-cache settings.

OmniRoute's implementation is integrated into its own OAuth/provider/executor abstractions rather than depending on that project at runtime.
