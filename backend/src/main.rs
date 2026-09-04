use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ffi::CStr;
use std::io::{self, BufRead, Write};
use std::process::{Command, Stdio};

unsafe extern "C" {
    fn mf_cs2_running() -> i32;
    fn mf_send_console_command(command: *const u8, length: usize) -> i32;
    fn mf_native_abs_probe(value: i32) -> i32;
    fn mf_native_version() -> *const std::ffi::c_char;
}

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    action: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn ok(id: u64, message: impl Into<String>, data: Value) -> Response {
    Response { id, ok: true, message: Some(message.into()), data: Some(data), error: None }
}
fn err(id: u64, error: impl Into<String>) -> Response {
    Response { id, ok: false, message: None, data: None, error: Some(error.into()) }
}

fn native_version() -> String {
    unsafe {
        let ptr = mf_native_version();
        if ptr.is_null() { return "unknown".into(); }
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

fn run_ruby(payload: &Value) -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = exe.parent().unwrap_or_else(|| std::path::Path::new("."))
        .join("analytics").join("analyze.rb");
    let mut child = Command::new("ruby")
        .arg(script)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Ruby runtime unavailable: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(payload.to_string().as_bytes()).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).into_owned()); }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

fn handle(req: Request) -> Response {
    match req.action.as_str() {
        "ping" => ok(req.id, "pong", json!({"pong": true})),
        "backend_info" => {
            let probe = unsafe { mf_native_abs_probe(-730) };
            ok(req.id, "MatchFrame core online", json!({
                "version": env!("CARGO_PKG_VERSION"),
                "rust": true,
                "cpp_native": native_version(),
                "assembly_probe": probe,
                "ruby_engine": "analytics/analyze.rb"
            }))
        }
        "cs2_status" => {
            let running = unsafe { mf_cs2_running() != 0 };
            ok(req.id, if running { "CS2 running" } else { "CS2 not running" }, json!({"running": running}))
        }
        "console" => {
            let Some(command) = req.payload.get("command").and_then(Value::as_str) else { return err(req.id, "Missing command"); };
            let command = command.trim();
            if command.is_empty() || command.len() > 512 || command.contains('\r') || command.contains('\n') { return err(req.id, "Invalid console command"); }
            let code = unsafe { mf_send_console_command(command.as_ptr(), command.len()) };
            if code == 0 { ok(req.id, format!("Sent to CS2: {command}"), json!({"native_code": code})) }
            else { err(req.id, format!("CS2 console bridge failed ({code}). CS2 must be running, the developer console must be enabled, and the current bridge uses the physical OEM-3/~ toggle key.")) }
        }
        "fast_abs" => {
            let value = req.payload.get("value").and_then(Value::as_i64).unwrap_or(0) as i32;
            ok(req.id, "Assembly helper executed", json!({"value": unsafe { mf_native_abs_probe(value) }}))
        }
        "ruby_analyze" => match run_ruby(&req.payload) {
            Ok(data) => ok(req.id, "Ruby analysis complete", data),
            Err(error) => err(req.id, error)
        },
        _ => err(req.id, format!("Unknown action: {}", req.action)),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(req) => handle(req),
            Err(error) => Response { id: 0, ok: false, message: None, data: None, error: Some(error.to_string()) }
        };
        if let Ok(json) = serde_json::to_string(&response) {
            let _ = writeln!(stdout, "{json}");
            let _ = stdout.flush();
        }
    }
}
