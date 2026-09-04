use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=native/matchframe_native.cpp");
    println!("cargo:rerun-if-changed=native/fastmath.asm");

    cc::Build::new()
        .cpp(true)
        .std("c++20")
        .file("native/matchframe_native.cpp")
        .compile("matchframe_native");

    let target = env::var("TARGET").unwrap_or_default();
    if target.contains("windows") && target.contains("x86_64") {
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        let object = out_dir.join("fastmath.obj");
        let status = Command::new("nasm")
            .args(["-f", "win64", "native/fastmath.asm", "-o"])
            .arg(&object)
            .status()
            .expect("NASM is required to build MatchFrame's assembly backend");
        assert!(status.success(), "NASM failed to compile native/fastmath.asm");
        println!("cargo:rustc-link-arg={}", object.display());
    }
}
