/**
 * 百度登录弹窗：等浏览器授权 / 授权失败。
 *
 * 只负责展示与取消；真正的 token 由后端在回调里落地，成功后后端发
 * `cloud-sync://state`，store 收到后 connected=true，本弹窗自然消失。
 */

import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { resolveNotice } from "@/lib/cloud-sync/notice"
import { useCloudSyncStore } from "@/stores/cloud-sync-store"

export function CloudSyncLoginDialog() {
  const login = useCloudSyncStore((state) => state.login)
  const cancelLogin = useCloudSyncStore((state) => state.cancelLogin)
  const beginLogin = useCloudSyncStore((state) => state.beginLogin)

  const open = login !== null
  if (!open) return null

  const pending = login.status === "pending"
  const failure = login.status === "error" ? resolveNotice(login.errorCode) : null

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : void cancelLogin())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{pending ? "正在等待浏览器授权" : "登录没有完成"}</DialogTitle>
          <DialogDescription>
            {pending
              ? "请在打开的浏览器页面里完成百度登录，完成后回到应用即可。"
              : failure?.message}
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            等待回调端口 17653…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">你也可以先退出这个弹窗，稍后在设置里重新点「登录百度账号」。</p>
        )}

        <DialogFooter>
          {pending ? null : (
            <Button variant="outline" onClick={() => void beginLogin()}>
              再试一次
            </Button>
          )}
          <Button variant={pending ? "outline" : "default"} onClick={() => void cancelLogin()}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
