use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;

const APP_BUNDLE_ID: &str = "com.qingmuai.writer";
const PROCESS_NAME: &str = "QMaiWrite.exe";

#[cfg(windows)]
extern "system" {
    fn SetConsoleOutputCP(codepage: u32) -> i32;
    fn SetConsoleCP(codepage: u32) -> i32;
}

fn set_utf8_console() {
    #[cfg(windows)]
    unsafe {
        SetConsoleOutputCP(65001);
        SetConsoleCP(65001);
    }
}

fn main() {
    set_utf8_console();

    println!("============================================");
    println!("  青幕AI写作数据清理工具");
    println!("  版本: 1.0.0");
    println!("============================================\n");

    // 1. 检测青幕是否正在运行
    if is_app_running() {
        eprintln!("【错误】检测到 {} 正在运行。", PROCESS_NAME);
        eprintln!("请先完全退出青幕AI写作软件，再运行此工具。");
        eprintln!("\n按 Enter 键退出...");
        let _ = read_line();
        std::process::exit(1);
    }

    // 2. 解析数据目录
    let roaming_dir = get_app_data_dir("APPDATA");
    let local_dir = get_app_data_dir("LOCALAPPDATA");

    println!("本工具将删除以下青幕AI写作数据目录：\n");
    print_dir(&roaming_dir, "漫游数据");
    print_dir(&local_dir, "本地数据");

    println!("\n警告：");
    println!("  • 此操作会清空所有软件内数据（AI会话、章节、大纲、模型设置、记忆库等）。");
    println!("  • 删除后青幕AI写作将恢复到首次安装状态。");
    println!("  • 不会删除您自行创建的项目文件夹。");
    println!("  • 删除的数据无法恢复，请确保已备份重要数据。\n");

    // 3. 二次确认
    print!("如果确认清空，请输入 DELETE 并回车：");
    let _ = io::stdout().flush();

    let input = read_line();
    if input.trim() != "DELETE" {
        println!("\n输入错误，操作已取消。");
        println!("按 Enter 键退出...");
        let _ = read_line();
        std::process::exit(0);
    }

    // 4. 执行删除
    println!("\n正在清理数据...\n");

    let roaming_ok = remove_dir_safely(&roaming_dir, "漫游数据");
    let local_ok = remove_dir_safely(&local_dir, "本地数据");

    println!();
    if roaming_ok && local_ok {
        println!("✅ 清理完成。青幕AI写作数据已全部清空。");
        println!("下次打开软件时将进入首次安装的初始状态。");
    } else {
        println!("⚠️ 清理过程中出现错误，部分数据可能未删除。");
        println!("请检查上方错误信息，或手动删除残留目录。");
    }

    println!("\n按 Enter 键退出...");
    let _ = read_line();
}

fn is_app_running() -> bool {
    let output = Command::new("tasklist")
        .args(&[
            "/FI",
            &format!("IMAGENAME eq {}", PROCESS_NAME),
            "/FO",
            "CSV",
            "/NH",
        ])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains(PROCESS_NAME)
        }
        Err(_) => false,
    }
}

fn get_app_data_dir(env_var: &str) -> PathBuf {
    env::var(env_var)
        .map(|p| PathBuf::from(p).join(APP_BUNDLE_ID))
        .unwrap_or_else(|_| PathBuf::from("<未知路径>"))
}

fn print_dir(path: &PathBuf, label: &str) {
    let status = if path.exists() {
        "存在"
    } else {
        "不存在（将跳过）"
    };
    println!("  [{}] {}", label, path.display());
    println!("  状态: {}\n", status);
}

fn remove_dir_safely(path: &PathBuf, label: &str) -> bool {
    if !path.exists() {
        println!("  [{}] 目录不存在，无需清理。", label);
        return true;
    }

    match fs::remove_dir_all(path) {
        Ok(_) => {
            println!("  ✅ [{}] 已删除: {}", label, path.display());
            true
        }
        Err(e) => {
            eprintln!("  ❌ [{}] 删除失败: {}", label, e);
            eprintln!("     路径: {}", path.display());
            false
        }
    }
}

fn read_line() -> String {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap_or(0);
    input
}
