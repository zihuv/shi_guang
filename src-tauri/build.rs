use std::env;
use std::process::Command;

fn main() {
    println!("cargo:rustc-check-cfg=cfg(needs_glibc_isoc23_compat)");

    if should_enable_glibc_isoc23_compat() {
        println!("cargo:rustc-cfg=needs_glibc_isoc23_compat");
    }

    tauri_build::build()
}

fn should_enable_glibc_isoc23_compat() -> bool {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return false;
    }

    if env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("gnu") {
        return false;
    }

    detect_glibc_version().is_some_and(|version| version < (2, 38))
}

fn detect_glibc_version() -> Option<(u32, u32)> {
    let output = Command::new("getconf")
        .arg("GNU_LIBC_VERSION")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let version = stdout.split_whitespace().nth(1)?;
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}
