// 只在 Windows 上编资源：这个壳本来就只为 Windows 打包。
// 图标变更后要让 cargo 重新链接，所以把 .rc 和 .ico 都登记成追踪目标。
fn main() {
    println!("cargo:rerun-if-changed=qmai-shell.rc");
    println!("cargo:rerun-if-changed=../../src-tauri/icons/icon.ico");

    #[cfg(windows)]
    {
        // 返回值只用于把编译产物路径交给链接器，这里不需要额外处理。
        let _ = embed_resource::compile("qmai-shell.rc", embed_resource::NONE);
    }
}
