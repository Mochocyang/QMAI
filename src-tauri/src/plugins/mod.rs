//! 开放插件系统：清单、注册表、进程监管、宿主能力面、安装器。
//!
//! 插件 = 一个常驻子进程 + 一个 plugin.json。通信走 stdio JSON-RPC（MCP），
//! 插件反调宿主能力走本机回环 HTTP（按 permissions 拦截）。
//! 设计见 docs/superpowers/specs/2026-10-27-开放插件系统-design.md

pub mod manifest;
pub mod paths;
