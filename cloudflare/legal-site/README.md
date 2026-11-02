# 条款站点部署说明

服务条款与隐私政策的**唯一事实来源**是同目录下的：

- `terms.md` —— 服务条款
- `privacy.md` —— 隐私政策

`index.html` 是**生成产物**，不要手改。

## 为什么必须用脚本生成

这里踩过坑：某次把 `privacy.md` 的免责条款全部修订好了，但真正对外发布的 `index.html`
还是旧版 —— 线上仍留着「不对任何安全事件造成的损失承担责任」这种自证违规的原文，
用户和监管看到的都是问题文本。两份文本并存、同版本号、同生效日却内容不同，
比单纯写错更难排查。

**所以：改条款只改 md，然后重新生成。**

```bash
node scripts/build-legal-site.mjs
```

## 部署

**线上唯一地址是 `qmai.pro/legal`**（由 qmai-account Worker 直接返回）。

```bash
# 1. 生成 index.html 与 account-worker/src/legal-page.ts
node scripts/build-legal-site.mjs

# 2. 部署 Worker（qmai.pro/legal、/terms、/privacy 都挂在它上面）
cd account-worker && wrangler deploy
```

| 入口 | 行为 |
|---|---|
| https://qmai.pro/legal | 条款总页（页内切换服务条款 / 隐私政策） |
| https://qmai.pro/terms | 302 → /legal#terms |
| https://qmai.pro/privacy | 302 → /legal#privacy |

**为什么不用 *.pages.dev**：那是 Cloudflare 默认域名，中国大陆访问不稳定；
qmai.pro 是已在百度开放平台登记的正式域名，用户点「同意」时必须能打开。
早期的 qmai-legal.pages.dev 项目已删除，避免同一份条款存在两个地址。

客户端「登录同意」处的链接常量在 `src/lib/account/legal-consent.ts`
（`LEGAL_TERMS_URL` / `LEGAL_PRIVACY_URL`，均为 `https://qmai.pro/legal#...`），
有单元测试锁定，改地址要同步改测试。

## 内容变更必须同步的地方

条款版本号要三处一致：

| 位置 | 说明 |
|---|---|
| `terms.md` / `privacy.md` 顶部「版本」 | 面向读者的版本号 |
| `src/lib/account/legal-consent.ts` 的 `LEGAL_TERMS_VERSION` | 客户端据此判断是否需要重新同意 |
| `scripts/build-legal-site.mjs` 生成的 `index.html` | 由 md 自动带出，无需手改 |

**版本号不一致的后果**：改了条款却没升 `LEGAL_TERMS_VERSION`，老用户不会被要求重新同意，
等于新条款对他们不生效。