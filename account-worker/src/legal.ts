/**
 * 隐私政策与服务条款页面。
 *
 * 为什么放在账号 Worker 而不是官网静态站：
 *   官网是 Cloudflare Pages 的纯静态部署，本地没有它的源码仓库，
 *   硬要往里塞页面就得整站重新上传（风险大且可能覆盖线上内容）。
 *   这里用精确路由 `qmai.pro/privacy`、`qmai.pro/terms` 提供，
 *   不影响站点其它路径。
 *
 * 内容必须与软件实际行为一致 —— 开放平台审核会核对
 * 「材料缺失或与应用实际不符」，写虚的比不写更糟。
 * 下面每一条都能在代码里找到对应实现，改动功能时请同步改这里。
 */

const EFFECTIVE_DATE = "2026-10-29"
const CONTACT_EMAIL = "support@qmai.pro"
/** 独立开发者的公开仓库，作为另一个可核验的联系入口。 */
const REPO_URL = "https://github.com/Mochocyang/QMAI"

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 20px 80px;
    background: #f6f7f9;
    color: #1f2328;
    font: 15px/1.85 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
          "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 44px 44px 56px;
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, .06);
  }
  h1 { margin: 0 0 6px; font-size: 26px; font-weight: 600; }
  h2 {
    margin: 36px 0 12px;
    padding-top: 20px;
    border-top: 1px solid #eaeef2;
    font-size: 17px;
    font-weight: 600;
  }
  h2:first-of-type { border-top: 0; padding-top: 0; }
  h3 { margin: 20px 0 8px; font-size: 15px; font-weight: 600; color: #24292f; }
  p { margin: 0 0 12px; }
  ul { margin: 0 0 14px; padding-left: 22px; }
  li { margin: 5px 0; }
  .meta { margin: 0 0 28px; color: #57606a; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 14px; }
  th, td { padding: 9px 10px; border: 1px solid #e1e6eb; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: #f0f2f4;
    font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  a { color: #0969da; }
  .note {
    margin: 16px 0;
    padding: 12px 16px;
    border-left: 3px solid #d0d7de;
    background: #f6f8fa;
    border-radius: 0 6px 6px 0;
    font-size: 14px;
  }
  footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid #eaeef2; color: #8b949e; font-size: 13px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #e6edf3; }
    main { background: #161b22; box-shadow: 0 8px 32px rgba(0, 0, 0, .4); }
    h2, footer { border-color: #21262d; }
    th, td { border-color: #21262d; }
    th { background: #1c2128; }
    code { background: #21262d; }
    .note { background: #1c2128; border-color: #30363d; }
    .meta, footer { color: #8b949e; }
    a { color: #4493f8; }
  }
  @media (max-width: 640px) {
    body { padding: 0; }
    main { padding: 28px 20px 40px; border-radius: 0; box-shadow: none; }
  }
`

function page(title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · 青幕AI写作</title>
<style>${STYLE}</style>
</head><body><main>
${body}
<footer>
  青幕AI写作 · 生效日期 ${EFFECTIVE_DATE}<br>
  联系邮箱 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> ·
  <a href="${REPO_URL}" rel="noreferrer noopener" target="_blank">开源仓库</a>
</footer>
</main></body></html>`
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // 政策页允许缓存一天：内容变更不频繁，且审核方抓取时更快。
      "cache-control": "public, max-age=86400",
    },
  })
}

// ---------------------------------------------------------------- 隐私政策

export function privacyPage(): Response {
  return page(
    "隐私政策",
    `
<h1>隐私政策</h1>
<p class="meta">适用于「青幕AI写作」桌面客户端及其配套服务 · 生效日期 ${EFFECTIVE_DATE}</p>

<p>
  「青幕AI写作」（以下简称"本软件"）是一款面向小说作者的桌面写作工具。
  本政策说明我们收集哪些信息、为什么收集、存放在哪里，以及你如何管理这些信息。
</p>

<div class="note">
  <strong>先说结论：</strong>你的小说正文默认只保存在你自己的电脑上。
  本软件不读取、不上传你的稿件内容 —— 除非你主动开启云同步，
  而此时数据是传到<strong>你自己的网盘</strong>，不经过我们的服务器。
</div>

<h2>一、我们不收集的信息</h2>
<ul>
  <li><strong>小说正文、大纲、设定等创作内容</strong>：默认仅存于本地。云同步时直接写入你指定的网盘（百度网盘、坚果云 / WebDAV、GitHub 私有仓库或本地文件夹），不经过我们的服务器。</li>
  <li><strong>与 AI 模型的对话内容</strong>：由本软件直接连接<strong>你自己配置的模型服务商</strong>，不经过我们的服务器。该服务商如何处理数据，适用其自身的隐私政策。</li>
  <li><strong>输入框之外的个人信息</strong>：我们不索取真实姓名、身份证号、通讯录、位置、生物特征等信息。</li>
</ul>

<h2>二、我们收集的信息</h2>

<h3>1. 账号信息（可选，注册后才收集）</h3>
<p>账号用于跨设备同步模型配置。不注册也能正常使用本软件的单机功能。</p>
<table>
  <tr><th>信息</th><th>用途</th><th>存储方式</th></tr>
  <tr><td>邮箱地址</td><td>注册、找回密码、发送验证码</td><td>明文存储（需用于登录与发信）</td></tr>
  <tr><td>密码</td><td>登录验证</td><td>PBKDF2-SHA256 加盐哈希，<strong>不存明文、不可逆</strong></td></tr>
  <tr><td>昵称</td><td>界面显示</td><td>明文存储</td></tr>
  <tr><td>头像（可选）</td><td>界面显示</td><td>原图字节存储</td></tr>
  <tr><td>登录会话令牌</td><td>保持登录状态</td><td>仅存哈希值</td></tr>
  <tr><td>请求 IP 的哈希值</td><td>防止验证码被刷、限流</td><td>加盐 SHA-256，<strong>不存明文 IP</strong></td></tr>
</table>

<h3>2. 模型配置的云端备份（可选，主动开启后才上传）</h3>
<p>
  如果你开启"模型配置云端保管"，配置（含 API Key）会先在<strong>你的设备上加密</strong>，
  再上传密文。加密密钥只在你本地，<strong>我们的服务器无法解密</strong>（服务端零知识）。
</p>

<h3>3. 网盘授权的中转数据（仅百度网盘）</h3>
<p>
  百度网盘采用标准 OAuth 授权。授权过程中，百度会返回一个访问令牌，
  由我们的服务端（Cloudflare Worker）临时保管：
</p>
<ul>
  <li>令牌以 <strong>AES-GCM 加密</strong>后存储，密钥不与数据同处；</li>
  <li>有效期最长 <strong>10 分钟</strong>，客户端取走后<strong>立即删除</strong>；</li>
  <li>仅用于交付给你本人的客户端，不会用于任何其它目的，也不会提供给第三方。</li>
</ul>
<p>其余网盘（坚果云 / WebDAV、GitHub、本地文件夹）的凭据只保存在你的电脑上，用系统级加密（Windows DPAPI）保护，<strong>不上传</strong>。</p>

<h3>4. 匿名使用统计</h3>
<p>用于了解版本与平台的分布情况、估算活跃用户数。这些数据<strong>无法定位到具体个人</strong>：</p>
<table>
  <tr><th>信息</th><th>说明</th></tr>
  <tr><td>设备随机标识</td><td>安装时随机生成的 UUID，不含硬件序列号或系统信息</td></tr>
  <tr><td>IP 的加盐哈希</td><td>仅用于"独立用户"去重，<strong>不保存明文 IP</strong></td></tr>
  <tr><td>软件版本与操作系统类型</td><td>判断兼容性问题</td></tr>
  <tr><td>启动 / 关闭时间</td><td>统计活跃度与在线人数</td></tr>
</table>
<p>我们<strong>不</strong>收集：你的稿件内容、搜索记录、剪贴板、键盘输入、窗口标题、浏览历史。</p>

<h2>三、信息如何使用</h2>
<ul>
  <li>提供并维护软件功能（登录、同步、授权）；</li>
  <li>排查故障与兼容性问题；</li>
  <li>防止滥用（验证码刷取、接口限流）；</li>
  <li>统计整体使用情况以决定改进方向。</li>
</ul>
<p>我们<strong>不会</strong>：向第三方出售你的信息；用于广告投放；用于训练 AI 模型。</p>

<h2>四、信息存储与保护</h2>
<ul>
  <li>账号与统计数据存储于 <strong>Cloudflare D1</strong>（美国），通过 HTTPS 传输。</li>
  <li>本地凭据使用 <strong>Windows DPAPI</strong> 加密，密文绑定当前系统用户账户 —— 换一个 Windows 账户无法解密。</li>
  <li>访问数据库与密钥的凭据仅开发者本人持有，不以任何形式写入客户端程序。</li>
</ul>

<h2>五、信息共享</h2>
<p>除下列情形外，我们不向第三方共享你的信息：</p>
<table>
  <tr><th>服务</th><th>用途</th><th>涉及信息</th></tr>
  <tr><td>Cloudflare（Workers / D1 / Pages）</td><td>账号与授权服务托管</td><td>上表所列账号信息</td></tr>
  <tr><td>Resend</td><td>发送注册 / 找回密码验证码</td><td>邮箱地址</td></tr>
  <tr><td>百度网盘开放平台</td><td>你主动授权后的网盘读写</td><td>OAuth 令牌</td></tr>
  <tr><td>GitHub</td><td>你主动连接私有仓库时的代码托管</td><td>GitHub 访问令牌</td></tr>
</table>
<p>依法需要配合有权机关调查时，我们会在法律允许的范围内告知你。</p>

<h2>六、你的权利</h2>
<ul>
  <li><strong>查阅与更正</strong>：在软件内查看昵称、头像、模型配置，并随时修改。</li>
  <li><strong>删除</strong>：软件内可清空模型配置云端备份、断开网盘授权、清空本地同步记录。</li>
  <li><strong>注销账号</strong>：发送邮件至 ${CONTACT_EMAIL}，我们会在 15 个工作日内删除你的账号与关联数据（法律法规要求保留的除外）。</li>
  <li><strong>撤回授权</strong>：可随时在百度网盘 / GitHub 的授权管理页面撤销本软件的访问权限。</li>
</ul>

<h2>七、未成年人</h2>
<p>本软件面向具备完全民事行为能力的用户。若你未满 14 周岁，请在监护人陪同下阅读本政策并使用本软件。</p>

<h2>八、政策更新</h2>
<p>本政策更新后会在本页面公布并更新顶部生效日期。涉及重大变更时，会在软件内提示。</p>

<h2>九、联系我们</h2>
<p>隐私相关问题请联系 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>。</p>
`,
  )
}

// ---------------------------------------------------------------- 服务条款

export function termsPage(): Response {
  return page(
    "服务条款",
    `
<h1>服务条款</h1>
<p class="meta">适用于「青幕AI写作」桌面客户端及其配套服务 · 生效日期 ${EFFECTIVE_DATE}</p>

<p>使用本软件即表示你已阅读并同意本条款。若不同意，请停止使用并卸载本软件。</p>

<h2>一、服务说明</h2>
<p>
  「青幕AI写作」是一款本地优先的小说写作工具，提供章节管理、大纲编排、设定管理、
  版本历史、AI 辅助写作与云同步等功能。软件主体在<strong>你的设备本地</strong>运行，
  不依赖我们的服务器即可完成核心写作功能。
</p>
<p>账号、模型配置云端备份、网盘授权中转属于<strong>可选</strong>的配套服务。</p>

<h2>二、账号</h2>
<ul>
  <li>你需要提供真实可用的邮箱以完成注册。</li>
  <li>你应妥善保管账号与密码；因你自身原因导致账号被盗用的，责任由你承担。</li>
  <li>一个账号供你个人使用，请勿出借、转售或共享。</li>
</ul>

<h2>三、使用规范</h2>
<p>你承诺不利用本软件从事下列行为：</p>
<ul>
  <li>制作、复制、发布、传播法律法规禁止的内容；</li>
  <li>侵犯他人知识产权、商业秘密或隐私权；</li>
  <li>对本软件进行反向工程、破解、篡改，或绕过授权与计费机制；</li>
  <li>利用本软件发起攻击、爬取数据或干扰服务正常运行；</li>
  <li>将本软件用于搭建面向他人的建站、图床、网盘迁移等转售服务。</li>
</ul>

<h2>四、AI 生成内容</h2>
<div class="note">
  <strong>请务必注意：</strong>AI 生成的内容由你所选择的模型服务商产出，
  可能存在事实错误、逻辑矛盾或与他人作品雷同的情况。
  你应<strong>自行审阅、修改并承担使用后果</strong>，尤其是公开发布或商业使用时。
</div>
<ul>
  <li>我们不保证 AI 生成内容的准确性、原创性或适用性。</li>
  <li>AI 服务的可用性、计费与内容策略由对应的模型服务商决定，与本软件无关。</li>
  <li>使用 AI 功能产生的费用由你向对应服务商支付。</li>
</ul>

<h2>五、知识产权</h2>
<ul>
  <li><strong>你的作品归你所有。</strong>你用本软件创作的全部内容，著作权归你本人，我们不作任何主张。</li>
  <li>本软件的程序、界面、图标等知识产权归开发者所有。</li>
  <li>你授予我们一项有限许可：为提供云同步、账号等可选服务，在必要范围内处理你的数据（详见<a href="/privacy">隐私政策</a>）。</li>
</ul>

<h2>六、云同步与数据安全</h2>
<ul>
  <li>云同步写入的是<strong>你自己的网盘账号</strong>。网盘的可用性、容量、限流与数据安全由对应服务商负责。</li>
  <li>涉及文件删除时，本软件会先记录同步历史并保留冲突副本；但<strong>你仍应自行备份重要稿件</strong>。</li>
  <li>因网盘服务商故障、账号被封、网络中断导致的数据丢失或同步失败，我们不承担赔偿责任，但会尽力提供排查协助。</li>
</ul>

<h2>七、服务变更与中断</h2>
<ul>
  <li>我们可能因升级、维护或不可抗力暂停配套服务，会尽量提前通知。</li>
  <li>本软件的<strong>本地写作功能不依赖服务器</strong>，配套服务中断不影响你继续写作与本地保存。</li>
  <li>若我们决定停止某项配套服务，会提前 30 天在软件内公告，并给出数据导出方式。</li>
</ul>

<h2>八、免责声明</h2>
<p>
  本软件按"现状"提供。在法律允许的最大范围内，我们不对因使用或无法使用本软件
  造成的间接损失、数据丢失、利润损失承担责任。本条款不排除法律强制规定不得排除的责任。
</p>

<h2>九、条款更新</h2>
<p>本条款更新后会在本页面公布并更新生效日期。更新后继续使用即视为接受新条款。</p>

<h2>十、适用法律与争议解决</h2>
<p>本条款适用中华人民共和国法律。因本条款产生的争议，双方应先友好协商；协商不成的，提交开发者所在地有管辖权的人民法院解决。</p>

<h2>十一、联系我们</h2>
<p>条款相关疑问请联系 <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>。</p>
`,
  )
}
