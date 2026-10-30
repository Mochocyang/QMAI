/**
 * 同步失败：错误码 -> 用户可读文案 / 动作（纯函数）。
 *
 * 后端只回 errorCode（可选 errorDetail 仅用于诊断），前端统一在这里翻译。
 * 禁止把后端原文直接展示给用户。
 */

export type NoticeAction = "relogin" | "detail" | "settings" | null

export interface NoticeCopy {
  message: string
  action: NoticeAction
}

export interface NoticeContext {
  /** 冲突/失败项的数量，用于把「有 N 个文件」填进去。 */
  count?: number
}

interface NoticeRule {
  message: string
  action: NoticeAction
}

const RULES: Record<string, NoticeRule> = {
  "auth.required": { message: "需要先登录网盘才能同步", action: "settings" },
  "auth.expired": { message: "百度授权已过期，请重新登录", action: "relogin" },
  "auth.revoked": { message: "账号授权已失效，请重新登录", action: "relogin" },
  "auth.user-limit": { message: "该应用的授权用户数已达上限，暂时无法继续同步", action: "detail" },
  "quota.rate-limit": { message: "网盘接口调用过于频繁，已暂停本次同步", action: "detail" },
  "quota.no-permission": { message: "当前应用没有该接口的权限", action: "detail" },
  "net.offline": { message: "无法连接网盘，请检查网络或代理设置", action: "detail" },
  "net.timeout": { message: "网盘响应超时，稍后会自动重试", action: "detail" },
  "storage.full": { message: "网盘空间不足，请清理后重试", action: "detail" },
  "remote.missing": { message: "同步目录不存在，请重新选择同步目录", action: "settings" },
  "remote.busy": { message: "网盘侧有任务正在执行，请稍后重试", action: "detail" },
  "local.locked": { message: "有文件正被占用（可能开着独立窗口），本轮已跳过", action: "detail" },
  "callback.port-in-use": {
    message: "本地登录回调端口 17653 被占用，请关闭占用它的程序后重试",
    action: "detail",
  },
  "conflict.detected": { message: "两边都改过同一个文件，已各自保留一份", action: "detail" },
  "not.implemented": { message: "这个网盘的接入还在开发中，下个版本才能用", action: null },
  "sync.disabled": { message: "云同步已关闭或还没连接网盘", action: "settings" },
  "sync.baidu-review": {
    message: "百度网盘授权成功，但文件同步还在等应用权限审核；现在可以先用本地文件夹同步",
    action: "settings",
  },
  "not.configured": {
    message: "还没有配置百度应用凭据（QMAI_BAIDU_APP_KEY / QMAI_BAIDU_SECRET_KEY），暂时无法登录",
    action: "settings",
  },
  "auth.in-progress": { message: "正在等浏览器里完成授权，别重复点", action: null },
  "auth.timeout": { message: "授权等待超时了，请重新登录", action: "relogin" },
  "auth.invalid-app": { message: "百度应用凭据不正确，请检查 AppKey / SecretKey", action: "settings" },
  "auth.store-failed": { message: "授权成功了，但凭据没能保存到本机，请重试", action: "relogin" },
  "sync.busy": { message: "上一轮同步还没结束，等它跑完再试", action: null },
  "sync.no-project": { message: "当前没有打开的书，暂时没有可同步的内容", action: null },
  "github.not-configured": {
    message: "这一版还没绑定 GitHub 应用，暂时先用 WebDAV 或网盘本地文件夹",
    action: "settings",
  },
  "github.misconfigured": { message: "GitHub 应用配置不对（client id），请重新安装或联系作者", action: "settings" },
  "github.device-flow-disabled": { message: "这个 GitHub 应用没开启设备授权，请联系作者", action: "settings" },
  "github.auth": {
    // token 被 GitHub 吊销（撤销授权 / 重新授权产生新 token / 长时间未用）。
    // 这不是网络问题，重试不会好，必须让用户重新授权。
    message: "GitHub 登录已失效（授权被撤销或已过期），请退出后重新登录",
    action: "settings",
  },
  "github.network": { message: "连不上 GitHub（网络问题），稍后会自动重试", action: "settings" },
  "github.rate-limited": { message: "GitHub 限制了请求频率，歇几分钟再点「立即同步」", action: "settings" },
  "github.repo-public": {
    message: "这个仓库是公开的，你的小说会被所有人看到 —— 请换成私有仓库",
    action: "settings",
  },
  "github.repo-missing": { message: "仓库不存在或没有访问权限（被删掉或改名了？）", action: "settings" },
  "github.read-only": { message: "这个仓库没有写权限，请换一个有权限的仓库", action: "settings" },
  "github.forbidden": { message: "GitHub 拒绝了这次操作（权限不足）", action: "settings" },
  "github.no-repo": { message: "还没选 GitHub 仓库", action: "settings" },
  "github.conflict": { message: "另一台设备刚提交过，正在重试", action: "settings" },
  "github.server": { message: "GitHub 服务端出错了，稍后重试", action: "settings" },
  "github.http": { message: "GitHub 返回了意外的结果，稍后重试", action: "settings" },
  "github.probe-mismatch": { message: "写进去的内容读回来不一致，仓库可能被拦截改写", action: "settings" },
  "folder.missing": { message: "这个文件夹不存在了，请重新选择", action: "settings" },
  "folder.not-directory": { message: "选中的不是文件夹", action: "settings" },
  "folder.not-writable": { message: "这个文件夹不能写入，请换一个（或检查权限）", action: "settings" },
  "folder.is-project": {
    message: "不能把某一本书自己的目录当作同步目录，请选它的上一级或另一个文件夹",
    action: "settings",
  },
  "webdav.auth": {
    message: "地址或账号密码不对（坚果云要用「应用密码」，不是登录密码）",
    action: "settings",
  },
  "webdav.not-found": { message: "这个地址下没有可用的同步目录，请检查路径", action: "settings" },
  "webdav.read-only": { message: "这个账号能读不能写，同步需要写入权限", action: "settings" },
  // 坚果云这类服务端按窗口限流（503 BlockedTemporarily）。说清楚「不是配置错了」，
  // 否则用户会去反复改地址和密码。
  "webdav.rate-limited": {
    message: "网盘限制了短时间内的请求次数，歇几分钟再点「立即同步」",
    action: "detail",
  },
  "webdav.tls": {
    message: "网盘证书不被信任（自建 NAS 常见），请换受信任的证书，或先用 http 地址",
    action: "settings",
  },
  "webdav.url": { message: "地址格式不对，需要以 http:// 或 https:// 开头", action: "settings" },
  "webdav.reconnect": { message: "这台机器上没保存这个网盘的密码，请重新输入一次", action: "settings" },
  "remote.bad-name": { message: "文件名里有网盘不接受的字符，本轮已跳过这个文件", action: "detail" },
  "remote.exists": { message: "网盘上已有同名文件，本轮已跳过", action: "detail" },
  "remote.too-large": { message: "有文件太大，超出同步支持的范围，本轮已跳过", action: "detail" },
  "baidu.bad-response": { message: "百度网盘返回了无法识别的内容，请稍后重试", action: "detail" },
  "baidu.no-uploadid": { message: "百度网盘没能给出上传会话，这次上传失败了，请重试", action: "detail" },
  "conflict.bad-choice": { message: "这个冲突选项不认识，请刷新后重试", action: "detail" },
}

/** 有明确数量时的冲突文案。 */
export function conflictNotice(count: number): NoticeCopy {
  return { message: `有 ${count} 个文件两边都改过，已各自保留一份`, action: "detail" }
}

export function resolveNotice(errorCode: string | undefined, context: NoticeContext = {}): NoticeCopy {
  if (!errorCode) {
    return { message: "同步失败，请稍后重试", action: "detail" }
  }

  /*
   * 归一化：Rust 侧会把服务端原话拼在错误码后面（`github.auth:Bad credentials`）。
   * 不剥离的话查表查不到，用户最后看到的就是裸的 `github.auth:Bad credentials` ——
   * 这既看不懂（英文），也没告诉他该做什么（真实投诉）。
   * 这里先按冒号前半段查表；带专用解析的分支（baidu/webdav）在后面优先处理。
   */
  const normalizedCode = errorCode.split(":")[0]
  if (
    normalizedCode !== errorCode &&
    !errorCode.startsWith("baidu.errno:") &&
    !errorCode.startsWith("baidu.status:") &&
    !errorCode.startsWith("webdav.status:")
  ) {
    const base = RULES[normalizedCode]
    if (base) return base
  }

  if (
    errorCode === "conflict.detected" &&
    typeof context.count === "number" &&
    context.count > 0
  ) {
    return conflictNotice(context.count)
  }

  // 百度用 errno 表达失败；未知 errno 也要给一句人话，而不是把码丢给用户。
  if (errorCode.startsWith("baidu.errno:") || errorCode.startsWith("baidu.status:")) {
    return { message: `百度网盘接口报错（${errorCode.split(":")[1]}），请稍后重试`, action: "detail" }
  }

  // 服务端状态码拼在码后面（webdav.status:502），别把裸码丢给用户。
  if (errorCode.startsWith("webdav.status:")) {
    return {
      message: `网盘返回了异常状态（${errorCode.slice("webdav.status:".length)}），请稍后重试`,
      action: "detail",
    }
  }

  // 百度会把拒绝原因拼在码后面（auth.denied:xxx），统一收成一句话。
  if (errorCode.startsWith("auth.denied")) {
    return { message: "百度授权没有完成，请重新登录", action: "relogin" }
  }

  const rule = RULES[errorCode]
  if (rule) return { message: rule.message, action: rule.action }

  return { message: `同步失败（错误码 ${errorCode}）`, action: "detail" }
}

export function noticeActionLabel(action: NoticeAction): string | null {
  if (action === "relogin") return "重新登录"
  if (action === "detail") return "查看详情"
  if (action === "settings") return "去登录"
  return null
}
