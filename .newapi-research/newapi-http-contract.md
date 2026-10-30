# New API (QuantumNous/new-api) — exact HTTP contract for the web frontend

Researched from source at **main / v1.0.0-rc.46** (latest release, 2026-10-21) and
**v0.9.28** (last v0.9.x release). Local server reports `local-dev`, which is a
custom `-ldflags -X .../common.Version=local-dev` build — the default hard-coded
value is `v0.0.0` (`common/constants.go:14`), so **the version string cannot be
trusted for feature detection**.

Sources
- https://github.com/QuantumNous/new-api/blob/main/router/api-router.go
- https://github.com/QuantumNous/new-api/blob/main/controller/user.go
- https://github.com/QuantumNous/new-api/blob/main/controller/token.go
- https://github.com/QuantumNous/new-api/blob/main/controller/access_token.go
- https://github.com/QuantumNous/new-api/blob/main/middleware/auth.go
- https://github.com/QuantumNous/new-api/blob/main/middleware/access_token_routes.go
- https://github.com/QuantumNous/new-api/blob/main/service/auth_session.go
- https://github.com/QuantumNous/new-api/blob/main/service/auth_token.go
- https://github.com/QuantumNous/new-api/blob/main/model/user.go
- https://github.com/QuantumNous/new-api/blob/main/model/token.go
- https://github.com/QuantumNous/new-api/blob/main/controller/topup.go
- https://github.com/QuantumNous/new-api/blob/v0.9.28/middleware/auth.go
- https://github.com/QuantumNous/new-api/blob/v0.9.28/controller/user.go
- https://github.com/QuantumNous/new-api/blob/v0.9.28/main.go
- https://github.com/QuantumNous/new-api/blob/main/web/src/lib/http-client.ts
- https://github.com/QuantumNous/new-api/blob/main/web/src/features/auth/api.ts
- https://github.com/QuantumNous/new-api/blob/main/web/src/features/keys/api.ts
- https://github.com/QuantumNous/new-api/blob/main/web/src/lib/currency.ts
- https://docs.newapi.pro/en/docs/api/management/user-auth/user-register-post
- https://docs.newapi.pro/en/docs/api/management/user-auth/user-login-post
- https://docs.newapi.pro/en/docs/api/management/user-management/user-self-get
- https://docs.newapi.pro/en/docs/api/management/token-management/token-get
- https://docs.newapi.pro/en/docs/api/management/system/status-get
- https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/http/Cargo.toml
- https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/http/src/commands.rs

---

## 0. Two incompatible generations

| | v0.9.x (≤ v0.9.28) | v1.0.0-rc.x (≥ rc.1 … rc.46) |
|---|---|---|
| Dashboard auth | gin session cookie `session` **+ mandatory `New-Api-User` header** | `Authorization: Bearer <15-min JWT>` (+ refresh cookie), or `Authorization: Bearer nap_…` PAT |
| `New-Api-User` header | **required on every authenticated `/api/*` call** | **removed** |
| Login returns | `data` = user object | `data` = `{access_token, token_type, access_expires_at, session, user}` |
| User "access token" | `GET /api/user/token` → 32-char opaque string, sent as `Authorization: <token>` | `GET /api/user/token` **removed**; replaced by `/api/user/access_tokens` (scoped PATs, `nap_` prefix) — legacy column retired 30 days after upgrade |
| `/api/token/` list | returns **plaintext `key`** | returns **masked** `key`; reveal via `POST /api/token/:id/key` |
| Cookies set on login | `session` (Path=/, HttpOnly, SameSite=Strict, 30 d, Secure=false) | `new_api_refresh` (Path=`/api/user/auth`, HttpOnly, SameSite=Strict) + `new_api_has_session` (Path=/, JS-readable) |

Detection recipe (works with `local-dev`):
1. `POST /api/user/login` with `{username,password}`.
2. If `data.access_token` is a non-empty string → v1.0.0-rc.
3. If `data.id`/`data.username` and a `session` cookie → v0.9.x.
Cross-checks: `GET /api/user/token` (200 + string ⇒ v0.9.x; 404 ⇒ v1.0.x),
`POST /api/user/auth/refresh` (exists 404/405 ⇒ v0.9.x).

---

## 1. Envelope conventions (both generations)

Every `/api/*` handler answers `200 OK` with a JSON envelope; **HTTP status is
not the error channel** in v0.9.x (v1.0.0 uses 400/401/403/429 for auth and
validation, still with the same envelope).

```json
{"success": true,  "message": "", "data": ...}
{"success": false, "message": "用户名已存在，或已注销"}
```

v1.0.0 adds optional stable fields on errors: `code` (e.g. `ACCESS_TOKEN_EXPIRED`,
`AUTH_SESSION_REVOKED`, `ACCESS_TOKEN_SCOPE_DENIED`, `ACCESS_TOKEN_ROUTE_UNDECLARED`),
plus `message_key`/`message_params` for web-console translation. `message` is
localized (zh/en) using `Accept-Language`/user setting — don't string-match it;
match `code` when present.

Pagination (`common.GetPageQuery`): query params `p` (page, 1-based), `page_size`
(alias `ps`, alias `size`, used by the token page), max 100, default 10.
Response `data` = `{"page":1,"page_size":10,"total":42,"items":[...]}`.

---

## 2. Registration — `POST /api/user/register`

Auth: none. Query: `?turnstile=<cf-token>` (required **only** if
`status.data.turnstile_check` is true; the value is a **query param**, not a body
field — `middleware/turnstile-check.go` reads `c.Query("turnstile")`).

Body (v1.0.0 `controller/user.go:217`, v0.9.28 identical):

```json
{
  "username": "alice",
  "password": "s3cret-pass",
  "email": "alice@example.com",
  "verification_code": "123456",
  "aff_code": "AB12"
}
```

| field | required | notes |
|---|---|---|
| `username` | yes | trimmed, `max=20` runes, unique among non-deleted users |
| `password` | yes | `min=8,max=128` |
| `email` | only when `email_verification` is on | normalized to lowercase; unique |
| `verification_code` | only when `email_verification` is on | from `GET /api/verification?email=…&turnstile=…` |
| `aff_code` | no | inviter's `aff_code`, not the new user's |

Response (200):

```json
{"success": true, "message": ""}
```

- **No session cookie, no token, no user object** — you must call `/api/user/login`
  afterwards.
- Gated by `register_enabled` and `password_register_enabled` from `/api/status`;
  failure envelopes: `"New user registration has been disabled by administrator"`,
  `"Password registration has been disabled by administrator, please use third-party account verification"`.
- Optional `constant.GenerateDefaultToken` build flag creates a default `sk-` token
  on registration (RemainQuota 500000, unlimited, never expires) — not returned.

---

## 3. Login — `POST /api/user/login`

Auth: none. Query: `?turnstile=`. Frontend call:
`api.post('/api/user/login?turnstile=' + token, {username, password})`
(`web/src/features/auth/api.ts:69`).

Body:

```json
{"username": "alice", "password": "s3cret-pass"}
```

Optional when `password_login_encryption_enabled` (RSA, key from
`GET /api/user/login/encryption-key`):

```json
{"username": "alice", "password_encrypted": "<base64>", "encryption_key_id": "<kid>"}
```

`username` may also be the account email (`ValidateAndFill` matches
`username = ? OR email = ?`).

### 3a. v1.0.0-rc — success without step-up verification

```json
{
  "message": "",
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs…",
    "token_type": "Bearer",
    "access_expires_at": 1793000000,
    "session": {
      "sid": "0f0c…-uuid",
      "current": true,
      "login_method": "password",
      "ip": "203.0.113.7",
      "user_agent": "Mozilla/5.0 …",
      "created_at": 1792999100,
      "last_active_at": 1792999100,
      "expires_at": 1795591100
    },
    "user": {
      "id": 12, "username": "alice", "display_name": "alice", "has_password": true,
      "role": 1, "status": 1, "email": "alice@example.com",
      "group": "default", "quota": 1250000, "used_quota": 340000,
      "request_count": 88, "aff_code": "AB12", "aff_count": 0,
      "aff_quota": 0, "aff_history_quota": 0, "inviter_id": 0,
      "setting": "{\"sidebar_modules\":\"…\"}", "sidebar_modules": "…",
      "permissions": {"sidebar_settings": true, "sidebar_modules": {"admin": false}, "admin_permissions": {}}
    }
  }
}
```

`access_token` = **HS256 JWT**, issuer `new-api`, audience `new-api-dashboard`,
claims `{token_use:"access", sid, uv, sv}`, signed with an HMAC key derived from
`common.SessionSecret`; TTL **15 minutes** (`service/auth_token.go:20`).

Response headers:

```
Set-Cookie: new_api_refresh=<opaque>; Path=/api/user/auth; Max-Age=<~30d>; HttpOnly; SameSite=Strict[; Secure]
Set-Cookie: new_api_has_session=1; Path=/; Max-Age=<~30d>; SameSite=Strict[; Secure]
```

The refresh cookie is **scoped to `/api/user/auth`** — it is *not* sent to
`/api/user/self`, `/api/token/`, etc. Bearer access token is the only thing that
authenticates ordinary `/api/*` calls.

Refresh: `POST /api/user/auth/refresh` (cookie only) → same `AuthBundle`;
`POST /api/user/auth/logout` (cookie + optional `X-Auth-Session: <sid>`).

### 3b. v1.0.0-rc — step-up verification required (2FA / passkey / email)

Some accounts must complete a verification (2FA enabled, or a login policy).
Response is 200 with **no cookie**:

```json
{
  "success": true,
  "message": "",
  "data": {
    "require_verification": true,
    "flow_token": "…",
    "expires_at": 1793000100,
    "methods": [{"type": "2fa", "available": true}, …]
  }
}
```

Then `POST /api/user/login/2fa` with `{"code": "123456", "flow_token": "…"}` (or
`POST /api/user/login/verify`, `POST /api/user/login/passkey/{begin,finish}`) →
same `AuthBundle`.

### 3c. v0.9.28 — success

```json
{
  "message": "",
  "success": true,
  "data": {
    "id": 12, "username": "alice", "display_name": "alice",
    "role": 1, "status": 1, "group": "default",
    "password": "", "quota": 0, "used_quota": 0, …zero-valued User fields…
  }
}
```

`data` is the serialized `model.User` built from
`{Id, Username, DisplayName, Role, Status, Group}` — so most fields are zero/empty
(`quota`, `aff_code`, …). **The authoritative quota comes from
`GET /api/user/self`.** Session cookie set by `sessions.Default(c).Save()`:

```
Set-Cookie: session=<signed>; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict
```

(`main.go:v0.9.28`: `sessions.Sessions("session", cookie.NewStore([]byte(common.SessionSecret)))`,
`Secure: false`.) If 2FA is enabled: `{"success":true,"message":"请输入两步验证码","data":{"require_2fa":true}}`
+ a *pending* session cookie; complete with `POST /api/user/login/2fa`.

### 3d. Both generations — other login errors

`{"success":false,"message":"Username or password is incorrect, or user has been banned"}`
(HTTP 200), `"Password login has been disabled by administrator"`,
`"Invalid parameters"`. Rate-limited by `CriticalRateLimit` (HTTP 429).

---

## 4. Current user — `GET /api/user/self`

### v1.0.0-rc

Auth (either):
- `Authorization: Bearer <access_token>` (JWT from login/refresh), or
- `Authorization: Bearer nap_<48 chars>` scoped PAT with scope **`profile:read`**
  (`middleware/access_token_routes.go:66`).
No `New-Api-User` header. Cookies are *not* accepted (refresh cookie is path-scoped
and session identity is not read from a session cookie in this generation —
`middleware/auth.go` only inspects `Authorization`).

```json
{
  "success": true, "message": "",
  "data": {
    "id": 12, "username": "alice", "display_name": "alice", "has_password": true,
    "role": 1, "status": 1, "email": "alice@example.com",
    "github_id": "", "discord_id": "", "oidc_id": "", "wechat_id": "", "telegram_id": "",
    "group": "default", "quota": 1250000, "used_quota": 340000, "request_count": 88,
    "aff_code": "AB12", "aff_count": 0, "aff_quota": 0, "aff_history_quota": 0,
    "inviter_id": 0, "linux_do_id": "", "setting": "…", "stripe_customer": "",
    "sidebar_modules": "…",
    "permissions": {
      "sidebar_settings": true,
      "sidebar_modules": {"admin": false},
      "admin_permissions": {}
    }
  }
}
```

401 bodies: `{"success":false,"message":"Unauthorized, not logged in and no access token provided","code":"AUTH_UNAUTHORIZED"}`,
`{"…","code":"AUTH_TOKEN_EXPIRED"}`, `{"…","code":"ACCESS_TOKEN_EXPIRED"}`,
`{"…","code":"AUTH_SESSION_REVOKED"}`, `{"…","code":"ACCESS_TOKEN_SCOPE_DENIED"}` (403).

### v0.9.28

`authHelper(c, RoleCommonUser)` (`middleware/auth.go`):
1. Read gin session (`username`,`role`,`id`,`status`,`group`).
2. If no session → read `Authorization` (raw header; a leading `Bearer ` is stripped
   by `model.ValidateAccessToken`), look up `users.access_token`.
3. **In both cases** require header `New-Api-User: <id>` and compare with the
   session/token user id → 401 `"无权进行此操作，未提供 New-Api-User"` /
   `"New-Api-User 与登录用户不匹配"`.
4. `role >= 1` (`RoleCommonUser`), status enabled.

The web frontend sets it globally: `headers: {'New-API-User': getUserIdFromLocalStorage()}`
(`web/src/helpers/api.js`).

```json
{"success": true, "message": "", "data": {"id":12,"username":"alice","display_name":"alice","role":1,
 "status":1,"email":"…","github_id":"","discord_id":"","oidc_id":"","wechat_id":"","telegram_id":"",
 "group":"default","quota":1250000,"used_quota":340000,"request_count":88,"aff_code":"AB12",
 "aff_count":0,"aff_quota":0,"aff_history_quota":0,"inviter_id":0,"linux_do_id":"",
 "setting":"…","stripe_customer":"","sidebar_modules":"…",
 "permissions":{"sidebar_settings":true,"sidebar_modules":{"admin":false}}}}
```

### 4b. "access_token" (user-scoped dashboard token)

**v0.9.x** — `GET /api/user/token` (auth: session/token + `New-Api-User`),
response `{"success":true,"message":"","data":"<29–32 char base62 string>"}`.
Regenerating **replaces** the previous token (`user.SetAccessToken`, `user.Update`).
Send it as:

```
Authorization: <token>          # or "Bearer <token>"
New-Api-User: <user id>         # still mandatory
```

i.e. in v0.9.x an access token alone is **not** sufficient; without `New-Api-User`
every call 401s. This is the single most common integration bug.

**v1.0.0-rc** — legacy per-user token is retired:
- `GET /api/user/token` route no longer exists (404);
- `model.ValidateAccessToken` returns `ErrLegacyAccessTokenRetired` unless the
  deployment recorded `LegacyAccessTokenRetireAt` during upgrade
  (`model/user_access_token.go`; zero ⇒ treated as retired);
- replacement = **scoped PATs**:

```
GET    /api/user/access_tokens            -> {items:[{id,name,token_hint,scopes,expires_at,created_at,last_used_at,last_used_ip}], legacy:{…}|null}
GET    /api/user/access_tokens/catalog    -> {groups:[…], max_tokens:N, default_expiry_days:N}
GET    /api/user/access_tokens/scopes     -> {resources:[…scope dictionary…]}
POST   /api/user/access_tokens            body {"name":"Desktop","scopes":["profile:read","api_key:read",…],"expires_at":0}
                                          -> {"success":true,"data":{"token":"nap_<43>","item":{…}}}
PATCH  /api/user/access_tokens/:id        body {"name":"…","scopes":[…]?}
DELETE /api/user/access_tokens/:id
DELETE /api/user/access_tokens/legacy
```

PAT rules: prefix `nap_`, only SHA-256 hash stored, `expires_at` must be 0
(never) or ≥ now+1 h, creation requires a **browser session + security proof**
(`X-Security-Proof` from `/api/verify`) — a headless desktop app cannot mint one;
have the user paste a PAT created in the web UI at *Settings → Security*.
Scopes used by the endpoints in this document:
`profile:read|write`, `api_key:read|write|reveal`, `wallet:read|write`,
`usage:read`, `account_security:read|write`. Undeclared routes fail closed with
403 `ACCESS_TOKEN_ROUTE_UNDECLARED`; `accessTokenRuleSession` routes
(`/api/user/sessions*`, `/api/user/access_tokens*`) reject every token.

---

## 5. API keys (`sk-…`) — `/api/token/`

### 5a. v1.0.0-rc

`GET /api/token/?p=1&size=10` (auth: user; PAT scope `api_key:read`)

```json
{
  "success": true, "message": "",
  "data": {
    "page": 1, "page_size": 10, "total": 2,
    "items": [{
      "id": 7, "user_id": 12,
      "key": "abcd**********wxyz",
      "status": 1,
      "name": "desktop",
      "created_time": 1792000000,
      "accessed_time": 1792990000,
      "expired_time": -1,
      "remain_quota": 500000,
      "unlimited_quota": false,
      "model_limits_enabled": false,
      "model_limits": "",
      "allow_ips": "",
      "used_quota": 12000,
      "group": "",
      "cross_group_retry": false,
      "allow_user_quota_query": true,
      "auto_groups": null
    }]
  }
}
```

`key` is masked as `first4 + "**********" + last4` (`model.MaskTokenKey`).
`status`: 1 enabled, 2 disabled, 3 expired, 4 exhausted.

`POST /api/token/` (scope `api_key:write`)

```json
{
  "name": "desktop",
  "remain_quota": 500000,
  "expired_time": -1,
  "unlimited_quota": false,
  "model_limits_enabled": false,
  "model_limits": "",
  "allow_ips": "",
  "allow_user_quota_query": true,
  "group": "",
  "auto_groups": [],
  "cross_group_retry": false
}
```

→ `{"success":true,"message":""}` — **the key is NOT in the response**.

Reveal it:

```
POST /api/token/7/key          -> {"success":true,"message":"","data":{"key":"<48 chars>"}}
POST /api/token/batch/keys     body {"ids":[7,8]} -> {"success":true,"data":{"keys":{"7":"…","8":"…"}}}
```

So the create flow is: `POST /api/token/` → `GET /api/token/?p=1&size=…` (find new
id) → `POST /api/token/:id/key`. (`expired_time` is a unix seconds value, `-1` =
never. Omitted `expired_time` = 0 ⇒ already expired in practice; always send it.)

Other operations: `GET /api/token/:id`, `PUT /api/token/` (same body + `id`),
`PUT /api/token/?status_only=true` `{"id":7,"status":2}`, `DELETE /api/token/:id`,
`POST /api/token/batch` `{"ids":[…]}` → `data: <deleted count>`,
`GET /api/token/search?keyword=&token=&p=&size=`, `GET /api/token/auto-groups`.

The key returned is the raw 48-char secret **without** the `sk-` prefix; clients
must send `Authorization: Bearer sk-<key>` (the relay strips `sk-` and any
`-<channel>` suffix: `strings.Split(key,"-")[0]`).

### 5b. v0.9.28 differences

- `GET /api/token/?p=1&page_size=10` returns the **plaintext** `key` in `items`
  (`pageInfo.SetItems(tokens)`), no reveal endpoint.
- `POST /api/token/` binds `model.Token` directly: body `{name, remain_quota,
  expired_time, unlimited_quota, model_limits_enabled, model_limits, allow_ips, group}`;
  `name` ≤ 30 chars; response `{"success":true,"message":""}` (no key either).
  No `auto_groups` / `allow_user_quota_query` / `cross_group_retry` handling.
- `GET /api/token/:id`, `PUT /api/token/`, `DELETE /api/token/:id`,
  `POST /api/token/batch`, `GET /api/token/search` exist.

---

## 6. Models

| endpoint | auth | response `data` |
|---|---|---|
| `GET /api/models` | user session (v0.9.x) / Bearer + `profile:read` (v1.0.x) | `{ "<channelType>": ["gpt-4o", …], … }` — **all models by channel type**, used by the admin channel editor. Not the user's list. |
| `GET /api/user/models?group=` | same user auth | `["gpt-4o-mini","claude-3-5-sonnet", …]` — models enabled for the user's group(s) |
| `GET /v1/models` | `Authorization: Bearer sk-…` (also `x-api-key`, `?key=`, `x-goog-api-key`) | OpenAI list |

`GET /api/models` (v1.0.0, `controller.DashboardListModels`):

```json
{"success": true, "data": {"1": ["gpt-4o","gpt-4o-mini"], "14": ["claude-3-5-sonnet-20241022"], "24": ["gemini-2.5-pro"]}}
```

`GET /api/user/models`:

```json
{"success": true, "message": "", "data": ["claude-3-5-sonnet-20241022","gpt-4o-mini"]}
```

`GET /v1/models` (OpenAI shape, plus a stray top-level `success`):

```json
{
  "success": true,
  "object": "list",
  "data": [
    {"id": "gpt-4o-mini", "object": "model", "created": 1626777600,
     "owned_by": "openai", "supported_endpoint_types": ["openai","openai-response"]}
  ]
}
```

`supported_endpoint_types` exists only in v1.0.x (`relaykit/dto/pricing.go`); v0.9.x
objects are `{id, object, created, owned_by}`. `GET /v1/models/:model` returns the
single object or `{"error":{…,"code":"model_not_found"}}`. Anthropic-flavoured
(`x-api-key` + `anthropic-version`) and Gemini-flavoured (`?key=`/`x-goog-api-key`)
responses differ (`{"data":[…],"first_id":…,"has_more":false,"last_id":…}` /
`{"models":[{"name":…}],"nextPageToken":null}`).

---

## 7. Redemption and top-up

### 7a. Redeem a code — `POST /api/user/topup`

Auth user. Body exactly:

```json
{"key": "REDEEM-CODE"}
```

Response 200:

```json
{"success": true, "message": "", "data": 500000}
```

`data` = the **quota credited** (int, not USD) — divide by `quota_per_unit` for money.

Failure envelopes (200, `success:false`):
- `"Redemption failed, please try again later"` — wrong/used/expired code (v1.0.0
  deliberately hides the reason; v0.9.28 forwards `model.Redeem`'s error text,
  e.g. `"兑换码无效"`, `"兑换码已被使用"`, `"兑换码已过期"`).
- v1.0.0 only: `"Payment, redemption, subscription, and invitation reward features are disabled. The administrator must confirm compliance terms before enabling them."`
  when `payment_compliance_confirmed` is false — the code is **not** redeemed.
- `"Top-up is processing, please try again later"` (per-user lock).

### 7b. Online top-up (v1.0.0; same routes in v0.9.28)

| endpoint | body | response |
|---|---|---|
| `GET /api/user/topup/info` | – | `data`: `{enable_online_topup, enable_stripe_topup, enable_creem_topup, enable_waffo_topup, enable_waffo_pancake_topup, enable_redemption, payment_compliance_confirmed, payment_compliance_terms_version, min_topup, amount_options, discount, topup_link, pay_methods:[{name,type,color,min_topup}], …}` |
| `POST /api/user/amount` | `{"amount":10}` | `{"message":"success","data":"73.00"}` — **string**, and **no `success` field** |
| `POST /api/user/pay` | `{"amount":10,"payment_method":"alipay"}` | `{"message":"success","data":{…epay form params…},"url":"https://pay.example.com/submit.php"}` |
| `GET /api/user/topup/self?p=1&page_size=10` | – | pageInfo of top-up records |
| `POST /api/user/stripe/pay` / `…/stripe/amount` / `…/creem/pay` / `…/waffo/pay` / `…/waffo-pancake/pay` | `{"amount":10}` | provider-specific pay URL |
| `POST /api/user/aff_transfer` | `{"quota":500000}` | `{"success":true,"message":"Transfer successful"}` |

Error shape for the whole payment family is `{"message":"error","data":"<text>"}`
(`paymentError`), i.e. check `message === "success"`, not `success`.

Amount semantics (`controller/topup.go:151`):
`payMoney = amount × price × topup_group_ratio × discount` — `amount` is in the
*display unit* (USD/CNY numbers, or raw tokens when `quota_display_type=="TOKENS"`,
in which case it is divided by `quota_per_unit` first). `data` is a 2-decimal
string in local currency.

---

## 8. Quota units and balance display

`/api/status` (no auth) fields that matter:

```json
{
  "success": true, "message": "",
  "data": {
    "version": "local-dev",
    "system_name": "New API", "logo": "…", "footer_html": "…",
    "server_address": "https://api.example.com",
    "quota_per_unit": 500000,
    "display_in_currency": true,
    "quota_display_type": "USD",
    "custom_currency_symbol": "€",
    "custom_currency_exchange_rate": 1.0,
    "usd_exchange_rate": 7.3,
    "price": 7.3,
    "register_enabled": true,
    "password_login_enabled": true,
    "password_register_enabled": true,
    "password_login_encryption_enabled": false,
    "email_verification": false,
    "turnstile_check": false,
    "turnstile_site_key": "",
    "github_oauth": false, "discord_oauth": false, "oidc_enabled": false,
    "linuxdo_oauth": false, "telegram_oauth": false, "wechat_login": false,
    "demo_site_enabled": false, "self_use_mode_enabled": false,
    "default_use_auto_group": false,
    "enable_batch_update": true, "enable_drawing": true, "enable_task": true,
    "enable_data_export": true, "data_export_default_time": "hour",
    "default_collapse_sidebar": false, "mj_notify_enabled": false,
    "chats": […], "HeaderNavModules": "…", "SidebarModulesAdmin": "…",
    "stripe_unit_price": 1, "api_info_enabled": true, "uptime_kuma_enabled": false,
    "announcements_enabled": true, "faq_enabled": true,
    "passkey_login": false, "passkey_display_name": "…", "passkey_rp_id": "…",
    "docs_link": "https://docs.newapi.pro", "oidc_*": "…"
  }
}
```

Formulas (identical in both generations; `common/constants.go:22` default
`QuotaPerUnit = 500000`, `setting/operation_setting/payment_setting_old.go:16`
default `Price = 7.3`):

```
usd_balance   = quota / quota_per_unit
tokens_balance= quota                       # when quota_display_type == "TOKENS"
display        = usd_balance × rate
  rate = 1                                  (USD)
       = usd_exchange_rate                  (CNY)
       = custom_currency_exchange_rate      (CUSTOM)
```

`price` is **not** a quota conversion: it is the *recharge price ratio* = local
currency charged per 1 system-USD of credit (used by `/api/user/amount` and
`/api/user/pay`). Frontend reference implementation:
`formatQuotaWithCurrency(quota) = formatCurrencyFromUSD(quota / quotaPerUnit)`
(`web/src/lib/currency.ts`).

Display only 2 significant decimals for ≥1 and 4 for <1; the web UI re-reads
`/api/status` on boot and caches it under `localStorage["status"]` (5 min stale /
30 min gc).

---

## 9. CORS / cookie / webview caveats (Tauri `@tauri-apps/plugin-http`)

1. **`/api/*` has no CORS middleware.** `middleware.CORS()` is applied only to
   `/dashboard/billing/*` + `/v1/dashboard/billing/*` (`router/dashboard.go:15`),
   the relay router (`router/relay-router.go:16`), `/api/usage/token` and
   `/api/log/token` (`router/api-router.go`). A browser `fetch`/XHR from an
   `https://app.example` origin to `/api/user/login` will fail preflight, and the
   web console is only ever served same-origin.
2. `middleware.CORS()` is `AllowAllOrigins: true` + `AllowCredentials: true` +
   `AllowHeaders: ["*"]`, which emits `Access-Control-Allow-Origin: *` **and**
   `Access-Control-Allow-Credentials: true` (`gin-contrib/cors` `utils.go`).
   Browsers reject credentialed reads with a wildcard origin, so **do not rely on
   cookie-based CORS calls from a browser context**. Use Bearer tokens.
3. `@tauri-apps/plugin-http` uses Rust `reqwest` → **no CORS at all**, and the
   `cookies` feature is **on by default** (`Cargo.toml: default = [..., "cookies"]`):
   a shared in-memory `CookieStoreMutex` is installed via
   `builder.cookie_provider(state.cookies_jar)`. So `Set-Cookie` from
   `POST /api/user/login` is stored and replayed to `/api/user/auth/refresh`
   automatically **within one app run** — it is not persisted, so after a restart
   the user must log in again (or you persist the PAT instead).
4. Requests are URL-scoped by Tauri capabilities (`http:default` /
   `http:allow-fetch` + `scope`). Add the API origin to
   `src-tauri/capabilities/*.json`, otherwise you get a permission error, not a
   network error.
5. SameSite/`Secure` are irrelevant to reqwest (no origin/SameSite enforcement),
   but `Secure` matters if you ever use a `tauri://` custom protocol — New API
   sets `Secure` from `common.SessionCookieSecure` (default **false**,
   `common/constants.go:37`), so plain-HTTP deployments do work.
6. **`SESSION_SECRET` must be set by the operator.** It defaults to
   `uuid.New().String()` per process (`common/constants.go:35`). Without it, every
   restart invalidates both v0.9.x session cookies *and* v1.0.0-rc access tokens
   (HS256 key = HMAC(SessionSecret)), i.e. "random 401 after server redeploy".
7. `Cache-Control: no-store` / `no-cache` is what the web client sends; harmless.
8. `/api/status` is unauthenticated and cheap → use it as the connectivity probe.

### Recommended Tauri flows

**A. v1.0.0-rc (preferred):**
`POST /api/user/login?turnstile=` → keep `data.access_token` in memory →
`Authorization: Bearer <token>` on every `/api/*` call → on 401
`POST /api/user/auth/refresh` (cookie jar replays `new_api_refresh`; must be sent
with `credentials`-equivalent i.e. same plugin client) → new access token.
Call refresh proactively at `access_expires_at - 60s`. If the login response has
`data.require_verification`, drive `/api/user/login/2fa` or fall back to asking
the user for a PAT (`Authorization: Bearer nap_…`, no refresh needed).

**B. v0.9.x:**
`POST /api/user/login` → keep `data.id` → send **both**
`New-Api-User: <id>` and (optionally) `Authorization: <access_token from GET /api/user/token>`
on every request; the cookie jar carries `session` too. If cookies are lost, the
access token keeps working — but **only together with `New-Api-User`**.

---

## 10. Quick endpoint matrix

| # | Method & path | v0.9.x auth | v1.0.x auth | Body / query | Success `data` |
|---|---|---|---|---|---|
| 1 | `POST /api/user/register` | none (+`?turnstile=`) | none (+`?turnstile=`) | `{username,password,email?,verification_code?,aff_code?}` | `null` (only `success`) |
| 2 | `POST /api/user/login` | none (+`?turnstile=`) | none (+`?turnstile=`) | `{username,password}` | v0.9: user obj; v1: `AuthBundle` or `LoginChallenge` |
| 2b | `POST /api/user/login/2fa` | pending session | – | `{code,flow_token}` | v1 `AuthBundle` |
| 3 | `GET /api/user/self` | cookie/`Authorization` **+ `New-Api-User`** | `Bearer` JWT or `nap_` PAT (`profile:read`) | – | user obj + `permissions` |
| 3b | `GET /api/user/token` | same | **removed** | – | access-token string |
| 3c | `POST /api/user/access_tokens` | – | session + `X-Security-Proof` | `{name,scopes,expires_at}` | `{token:"nap_…",item}` |
| 3d | `POST /api/user/auth/refresh` | – | refresh cookie | – | `AuthBundle` |
| 4 | `GET /api/token/?p=1&size=10` | user | `api_key:read` | – | pageInfo (plaintext key in v0.9, masked in v1) |
| 4b | `POST /api/token/` | user | `api_key:write` | token fields | `null` |
| 4c | `POST /api/token/:id/key` | – | `api_key:reveal` | – | `{key}` |
| 5 | `GET /api/models` | user | `profile:read` | – | `{channelType:[models]}` |
| 5b | `GET /api/user/models` | user | `profile:read` | `?group=` | `[model,…]` |
| 5c | `GET /v1/models` | `Bearer sk-…` | `Bearer sk-…` | – | OpenAI list |
| 6 | `POST /api/user/topup` | user | `wallet:write` | `{key}` | quota credited (int) |
| 6b | `POST /api/user/amount` | user | `wallet:read` | `{amount}` | `"73.00"` (no `success`) |
| 6c | `POST /api/user/pay` | user | `wallet:write` | `{amount,payment_method}` | epay params + `url` |
| 7 | `GET /api/status` | none | none | – | see §8 |
