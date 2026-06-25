// Prevent additional console window on Windows for packaged builds.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    llm_wiki_lib::run();
}
