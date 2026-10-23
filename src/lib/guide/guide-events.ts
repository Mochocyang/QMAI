/**
 * 引导模块对外的浏览器事件名。
 *
 * 只有一个用途：设置页的「重新开始引导」要让**外壳退出设置页**（否则第一步
 * 「在书架点设置」会指着一个已经点过的按钮）。设置分区在 `ContentArea` 深处，
 * 拿不到外壳的 `setShowGlobalSettings`，改 store 又会把「谁拥有这个开关」
 * 这条边界弄乱，所以用事件通知一次。
 */
export const GUIDE_RESTART_EVENT = "qmai-guide-restart"
