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

站点是自包含单页（无外部 CSS/JS 依赖），直接部署目录即可：

```bash
wrangler pages deploy cloudflare/legal-site --project-name qmai-legal
```

- 线上地址：https://qmai-legal.pages.dev/
- 服务条款：https://qmai-legal.pages.dev/#terms
- 隐私政策：https://qmai-legal.pages.dev/#privacy

客户端「登录同意」处的链接常量在 `src/lib/account/legal-consent.ts`
（`LEGAL_TERMS_URL` / `LEGAL_PRIVACY_URL`），有单元测试锁定，改地址要同步改测试。

## 绑定自定义域名（可选）

`qmai.pro/legal` 目前不可用：该路径落到营销站首页的 SPA 回退，
用户点「同意」看到的是产品介绍而不是条款。绑定方式：

1. Cloudflare 控制台 → Pages → `qmai-legal` → Custom domains
2. 添加 `legal.qmai.pro` 或把 `qmai.pro/legal` 用 Rules 重写到该 Pages 项目
3. 绑定成功后，把 `legal-consent.ts` 里两个常量与对应测试一起改成新域名

## 内容变更必须同步的地方

条款版本号要三处一致：

| 位置 | 说明 |
|---|---|
| `terms.md` / `privacy.md` 顶部「版本」 | 面向读者的版本号 |
| `src/lib/account/legal-consent.ts` 的 `LEGAL_TERMS_VERSION` | 客户端据此判断是否需要重新同意 |
| `scripts/build-legal-site.mjs` 生成的 `index.html` | 由 md 自动带出，无需手改 |

**版本号不一致的后果**：改了条款却没升 `LEGAL_TERMS_VERSION`，老用户不会被要求重新同意，
等于新条款对他们不生效。
