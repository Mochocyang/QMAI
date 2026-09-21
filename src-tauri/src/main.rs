#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    qmai::assert_supported_platform();
    qmai::run();
}
