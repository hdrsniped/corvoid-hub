use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::webview::PageLoadEvent;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

const BLOCKED_NAMES: [&str; 2] = [".obsidian", ".smart-env"];
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CONFIG_FILE_NAME: &str = "corvoid-hub.json";
/// Windows entry attribute that marks a link, a junction or any other reparse point.
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

/// Keys of corvoid-hub.json. Every key is optional; a missing key falls back to a default.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ConfigFile {
    /// Root of the hub (rules, skills, packs, apps.yaml...). Default: %USERPROFILE%\ai-hub.
    hub: Option<String>,
    /// Root of the Vortex vault. Default: %USERPROFILE%\Documents\Vortex.
    vault: Option<String>,
    /// vlog.ps1. Quick log is off when it is missing.
    vlog: Option<String>,
    /// needle-log.ps1 (quick log suggestions). Quick log is off when it is missing.
    needle_log: Option<String>,
    /// Log folder of the app itself. Default: <hub>\.logs.
    log_dir: Option<String>,
}

/// Resolved paths, loaded once at startup. Everything the app touches derives from here.
#[derive(Clone)]
struct Config {
    hub: PathBuf,
    vault: PathBuf,
    log_dir: PathBuf,
    vlog: Option<PathBuf>,
    needle_log: Option<PathBuf>,
    /// The config file that was used, or "defaults".
    source: String,
}

impl Config {
    fn skills(&self) -> PathBuf {
        self.hub.join("skills")
    }
    fn inbox(&self) -> PathBuf {
        self.hub.join("inbox")
    }
    fn packs(&self) -> PathBuf {
        self.hub.join("packs")
    }
    fn projects(&self) -> PathBuf {
        self.vault.join("Projects")
    }
    fn logs(&self) -> PathBuf {
        self.vault.join("Log")
    }
    fn hub_sync(&self) -> PathBuf {
        self.hub.join("hub-sync.ps1")
    }
    fn apply_locks(&self) -> PathBuf {
        self.hub.join("bin").join("apply-locks.ps1")
    }
    fn quick_log(&self) -> bool {
        self.vlog.is_some() && self.needle_log.is_some()
    }
}

static CONFIG: OnceLock<Config> = OnceLock::new();

fn config() -> &'static Config {
    CONFIG.get_or_init(load_config)
}

fn user_home() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// `CORVOID_HUB_CONFIG`, else corvoid-hub.json next to the executable, else %USERPROFILE%\.corvoid-hub.json.
fn config_file() -> Option<PathBuf> {
    if let Some(raw) = env::var_os("CORVOID_HUB_CONFIG") {
        let p = PathBuf::from(raw);
        if !p.as_os_str().is_empty() {
            return Some(p);
        }
    }
    if let Some(dir) = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        let p = dir.join(CONFIG_FILE_NAME);
        if p.is_file() {
            return Some(p);
        }
    }
    let p = user_home().join(format!(".{CONFIG_FILE_NAME}"));
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

fn path_text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Reads the config file (when there is one) and fills the missing keys with defaults.
/// A broken file is logged and the defaults are used, so the app always starts.
fn load_config() -> Config {
    let mut file = ConfigFile::default();
    let mut source = "defaults".to_string();
    if let Some(path) = config_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<ConfigFile>(&text) {
                Ok(parsed) => {
                    file = parsed;
                    source = path_text(&path);
                }
                Err(e) => log::warn!("ignoring hub config {}: {e}", path.display()),
            },
            Err(e) => log::warn!("cannot read hub config {}: {e}", path.display()),
        }
    }

    let home = user_home();
    let take = |value: Option<String>| {
        value
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
    };
    let hub = take(file.hub).unwrap_or_else(|| home.join("ai-hub"));
    let vault = take(file.vault).unwrap_or_else(|| home.join("Documents").join("Vortex"));
    let log_dir = take(file.log_dir).unwrap_or_else(|| hub.join(".logs"));

    Config {
        hub,
        vault,
        log_dir,
        vlog: take(file.vlog),
        needle_log: take(file.needle_log),
        source,
    }
}

/// The resolved paths the frontend works with. See AppConfig in src/core/config.ts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    hub: String,
    vault: String,
    log_dir: String,
    skills: String,
    inbox: String,
    packs: String,
    hub_sync: String,
    apply_locks: String,
    projects: String,
    logs: String,
    vlog: Option<String>,
    needle_log: Option<String>,
    /// The config file that was read, or "defaults".
    source: String,
    /// True when both vlog and needle-log are configured.
    quick_log: bool,
    hub_exists: bool,
    vault_exists: bool,
}

/// The paths every screen uses. Loaded once by the frontend before the first render.
#[tauri::command]
fn get_config() -> ConfigView {
    let c = config();
    ConfigView {
        hub: path_text(&c.hub),
        vault: path_text(&c.vault),
        log_dir: path_text(&c.log_dir),
        skills: path_text(&c.skills()),
        inbox: path_text(&c.inbox()),
        packs: path_text(&c.packs()),
        hub_sync: path_text(&c.hub_sync()),
        apply_locks: path_text(&c.apply_locks()),
        projects: path_text(&c.projects()),
        logs: path_text(&c.logs()),
        vlog: c.vlog.as_deref().map(path_text),
        needle_log: c.needle_log.as_deref().map(path_text),
        source: c.source.clone(),
        quick_log: c.quick_log(),
        hub_exists: c.hub.is_dir(),
        vault_exists: c.vault.is_dir(),
    }
}

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    /// Follows symbolic links, so a linked skill folder counts as a folder.
    is_dir: bool,
    /// True when the entry itself is a symbolic link (or junction).
    symlink: bool,
    size: u64,
    modified: Option<u64>,
}

/// Claude Code and Antigravity skill folders, from USERPROFILE. None when USERPROFILE is unset.
fn user_skill_dirs() -> Option<(PathBuf, PathBuf)> {
    let home = PathBuf::from(env::var_os("USERPROFILE")?);
    Some((
        home.join(".claude").join("skills"),
        home.join(".gemini").join("config").join("skills"),
    ))
}

/// Canonical folders the app may touch: the hub, the vault, and the two harness skill folders.
/// Folders that do not exist are skipped.
fn allowed_roots() -> Vec<PathBuf> {
    let c = config();
    let mut raw = vec![c.hub.clone(), c.vault.clone()];
    if let Some((claude, gemini)) = user_skill_dirs() {
        raw.push(claude);
        raw.push(gemini);
    }
    raw.iter().filter_map(|r| r.canonicalize().ok()).collect()
}

/// True when `p` (already canonical) is an allowed root or inside one of them.
fn is_inside_roots(p: &Path) -> bool {
    allowed_roots().iter().any(|r| p.starts_with(r))
}

/// Canonical path text without the Windows verbatim prefix that canonicalize adds.
fn strip_verbatim(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => rest.to_string(),
        None => s,
    }
}

/// Rejects a canonical path that passes through a blocked folder (.obsidian, .smart-env).
fn check_not_blocked(p: &Path) -> Result<(), String> {
    for comp in p.components() {
        if let Component::Normal(s) = comp {
            let lower = s.to_string_lossy().to_lowercase();
            if BLOCKED_NAMES.contains(&lower.as_str()) {
                return Err(format!("blocked folder in path: {lower}"));
            }
        }
    }
    Ok(())
}

/// Canonicalizes `raw` (the file itself, or its parent when the file does not exist yet)
/// and rejects anything outside the hub or vault root, or inside a blocked folder.
fn safe_path(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("empty path".into());
    }
    let p = PathBuf::from(raw);
    let canon = if p.exists() {
        p.canonicalize().map_err(|e| format!("cannot resolve {raw}: {e}"))?
    } else {
        let parent = p.parent().ok_or_else(|| format!("no parent for {raw}"))?;
        let name = p.file_name().ok_or_else(|| format!("no file name in {raw}"))?;
        parent
            .canonicalize()
            .map_err(|e| format!("cannot resolve parent of {raw}: {e}"))?
            .join(name)
    };

    if !is_inside_roots(&canon) {
        return Err(format!("path is outside the hub and vault roots: {raw}"));
    }
    check_not_blocked(&canon)?;
    Ok(canon)
}

/// Like `safe_path`, but the path may point into folders that do not exist yet.
/// Walks up to the nearest existing ancestor, canonicalizes it, re-attaches the missing
/// names, then applies the same root and blocked-folder checks to the result.
/// Relative paths are refused, and `..` is never kept (canonicalization resolves it).
fn safe_path_for_write(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("empty path".into());
    }
    let p = PathBuf::from(raw);
    if p.exists() {
        return safe_path(raw);
    }
    if !p.is_absolute() {
        return Err(format!("path must be absolute: {raw}"));
    }

    let mut missing: Vec<OsString> = Vec::new();
    let mut ancestor = p.as_path();
    while !ancestor.exists() {
        let name = ancestor
            .file_name()
            .ok_or_else(|| format!("no file name in {raw}"))?;
        missing.push(name.to_os_string());
        ancestor = ancestor
            .parent()
            .ok_or_else(|| format!("no existing parent for {raw}"))?;
    }

    let mut canon = ancestor
        .canonicalize()
        .map_err(|e| format!("cannot resolve {}: {e}", ancestor.display()))?;
    for name in missing.iter().rev() {
        canon.push(name);
    }
    if !is_inside_roots(&canon) {
        return Err(format!("path is outside the hub and vault roots: {raw}"));
    }
    check_not_blocked(&canon)?;
    Ok(canon)
}

/// Inbox and skill names: lowercase letters, digits and dashes, 1 to 100 chars.
fn valid_slug(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Resolves `inbox/<name>` for a new item. It must not exist yet.
fn new_inbox_dest(name: &str) -> Result<PathBuf, String> {
    if !valid_slug(name) {
        return Err("name must be lowercase letters, digits and dashes only".into());
    }
    let dest = config().inbox().join(name);
    if dest.exists() {
        return Err(format!("inbox item already exists: {name}"));
    }
    safe_path_for_write(&dest.to_string_lossy())
}

fn unix_secs(t: SystemTime) -> Option<u64> {
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

/// (year, month, day) for a day count since 1970-01-01 (civil-from-days, no extra crate needed).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

/// Today's date in UTC as YYYY-MM-DD.
fn today_utc() -> String {
    let (y, m, d) = civil_from_days(unix_secs(SystemTime::now()).unwrap_or(0) as i64 / 86_400);
    format!("{y:04}-{m:02}-{d:02}")
}

/// UTC timestamp as YYYYMMDD-HHMMSS, for the trash folder names of removed skills.
fn utc_stamp() -> String {
    let secs = unix_secs(SystemTime::now()).unwrap_or(0) as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rest = secs.rem_euclid(86_400);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = safe_path(&path)?;
    if !dir.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if BLOCKED_NAMES.contains(&name.to_lowercase().as_str()) {
            continue;
        }
        let symlink = entry.file_type().map_err(|e| e.to_string())?.is_symlink();
        // Follow links; a broken link falls back to the link's own metadata.
        let meta = match fs::metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => entry.metadata().map_err(|e| e.to_string())?,
        };
        out.push(DirEntry {
            name,
            is_dir: meta.is_dir(),
            symlink,
            size: meta.len(),
            modified: meta.modified().ok().and_then(unix_secs),
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let file = safe_path(&path)?;
    fs::read_to_string(&file).map_err(|e| format!("read {path}: {e}"))
}

/// Writes a file. Missing parent folders (for example a new project folder) are created.
#[tauri::command]
fn write_text(path: String, content: String) -> Result<(), String> {
    let file = safe_path_for_write(&path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create folder for {path}: {e}"))?;
    }
    fs::write(&file, content).map_err(|e| format!("write {path}: {e}"))
}

/// Deletes one file from `packs/` or `inbox/`. Folders are refused and links are not
/// followed, so a single call can never wipe a skill folder or a whole pack tree.
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let is_link = fs::symlink_metadata(&path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    if is_link {
        return Err(format!("symbolic links cannot be deleted: {path}"));
    }
    let file = safe_path(&path)?;
    if !file.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let packs = safe_path(&path_text(&config().packs()))?;
    let inbox = safe_path(&path_text(&config().inbox()))?;
    if !file.starts_with(&packs) && !file.starts_with(&inbox) {
        return Err(format!("only files in packs or inbox can be deleted: {path}"));
    }
    fs::remove_file(&file).map_err(|e| format!("delete {path}: {e}"))
}

#[derive(Serialize)]
pub struct SkillRoots {
    hub: String,
    claude: Option<String>,
    gemini: Option<String>,
}

/// Where skills live: the hub, Claude Code (local) and Antigravity (local).
#[tauri::command]
fn skill_roots() -> SkillRoots {
    let (claude, gemini) = match user_skill_dirs() {
        Some((c, g)) => (
            Some(c.to_string_lossy().into_owned()),
            Some(g.to_string_lossy().into_owned()),
        ),
        None => (None, None),
    };
    SkillRoots {
        hub: path_text(&config().skills()),
        claude,
        gemini,
    }
}

/// True when `path` exists. The apps index points at repos anywhere on disk, so this check is
/// deliberately outside the hub and vault allow-list: it answers metadata only, never content.
#[tauri::command]
fn path_exists(path: String) -> bool {
    !path.trim().is_empty() && PathBuf::from(path).exists()
}

/// Canonical path of an allowed path (symlinks followed), without the verbatim prefix.
#[tauri::command]
fn resolve_path(path: String) -> Result<String, String> {
    Ok(strip_verbatim(&safe_path(&path)?))
}

/// Label used in messages and in the trash folder name for one of the three skill targets.
fn skill_target_label(target: &str) -> &'static str {
    match target {
        "hub" => "Hub",
        "claude" => "Claude Code",
        "gemini" => "Antigravity",
        _ => "this folder",
    }
}

/// Raw skill folder of a target: `<hub>\skills`, ~/.claude/skills or ~/.gemini/config/skills.
fn skill_root_raw(target: &str) -> Result<PathBuf, String> {
    match target {
        "hub" => Ok(config().skills()),
        "claude" => user_skill_dirs()
            .map(|(claude, _)| claude)
            .ok_or_else(|| "no user profile, so there is no Claude Code skill folder".to_string()),
        "gemini" => user_skill_dirs()
            .map(|(_, gemini)| gemini)
            .ok_or_else(|| "no user profile, so there is no Antigravity skill folder".to_string()),
        other => Err(format!("unknown skill target: {other}")),
    }
}

/// Creates a skill root when it is missing and returns its real path, so a first copy works on a
/// fresh machine. The folder becomes an allowed root, so the destination passes the usual checks.
fn prepare_skill_root(raw: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(raw).map_err(|e| format!("create {}: {e}", raw.display()))?;
    raw.canonicalize()
        .map_err(|e| format!("cannot resolve {}: {e}", raw.display()))
}

/// The three skill folders that exist, as (label, real path).
fn resolved_skill_roots() -> Vec<(&'static str, PathBuf)> {
    let (claude, gemini) = match user_skill_dirs() {
        Some((c, g)) => (Some(c), Some(g)),
        None => (None, None),
    };
    let candidates = [
        ("hub", Some(config().skills())),
        ("claude", claude),
        ("gemini", gemini),
    ];
    let mut out = Vec::new();
    for (label, raw) in candidates {
        if let Some(p) = raw {
            if let Ok(canon) = p.canonicalize() {
                out.push((label, canon));
            }
        }
    }
    out
}

/// True for a symbolic link, a junction or any other reparse point.
fn is_link(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// Moves a skill folder into `<hub>\backups\removed-skills\<root>-<name>-<stamp>`. Never deletes.
fn trash_skill(src: &Path, root_label: &str) -> Result<String, String> {
    let name = src
        .file_name()
        .ok_or_else(|| format!("no folder name in {}", src.display()))?
        .to_string_lossy()
        .into_owned();
    let base = config().hub.join("backups").join("removed-skills");
    fs::create_dir_all(&base).map_err(|e| format!("create {}: {e}", base.display()))?;

    let stamp = utc_stamp();
    let mut dest = base.join(format!("{root_label}-{name}-{stamp}"));
    let mut n = 2;
    while dest.exists() {
        dest = base.join(format!("{root_label}-{name}-{stamp}-{n}"));
        n += 1;
    }

    if fs::rename(src, &dest).is_err() {
        // Another volume (a harness folder on C:): copy first, then remove the original.
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        if let Err(e) = copy_tree(src, &dest) {
            let _ = fs::remove_dir_all(&dest);
            return Err(e);
        }
        fs::remove_dir_all(src).map_err(|e| {
            format!(
                "copied to {} but the original could not be removed: {e}",
                dest.display()
            )
        })?;
    }
    Ok(strip_verbatim(&dest))
}

/// Copies a skill folder into another skill root (hub, Claude Code or Antigravity).
/// `keep_original: false` moves it: the original goes to `<hub>\backups\removed-skills`.
#[tauri::command]
fn skill_transfer(
    src_path: String,
    target: String,
    name: String,
    keep_original: bool,
) -> Result<String, String> {
    if !valid_slug(&name) {
        return Err("name must be lowercase letters, digits and dashes only".into());
    }
    let src = safe_path(&src_path)?;
    if !src.is_dir() {
        return Err(format!("not a folder: {src_path}"));
    }
    let dest_root = prepare_skill_root(&skill_root_raw(&target)?)?;
    if src.starts_with(&dest_root) {
        return Err(format!("this skill is already in {}", skill_target_label(&target)));
    }
    let dest_raw = dest_root.join(&name);
    if dest_raw.exists() {
        return Err(format!(
            "{} already has a skill named {name}",
            skill_target_label(&target)
        ));
    }
    let dest = safe_path_for_write(&dest_raw.to_string_lossy())?;
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    if let Err(e) = copy_tree(&src, &dest) {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    if !keep_original {
        let root_label = resolved_skill_roots()
            .into_iter()
            .find(|(_, r)| src.parent() == Some(r.as_path()))
            .map(|(label, _)| label);
        match root_label {
            Some(label) => {
                if let Err(e) = trash_skill(&src, label) {
                    return Err(format!(
                        "copied to {}, but the original could not be moved: {e}",
                        strip_verbatim(&dest)
                    ));
                }
            }
            None => {
                let _ = fs::remove_dir_all(&dest);
                return Err(
                    "only a skill folder that sits directly in a skill root can be moved; copy it instead"
                        .into(),
                );
            }
        }
    }
    Ok(strip_verbatim(&dest))
}

/// Moves a skill folder to `<hub>\backups\removed-skills`. Links are refused: a harness link is
/// the hub's copy, so the hub is where it has to go.
#[tauri::command]
fn skill_remove(path: String) -> Result<String, String> {
    let meta = fs::symlink_metadata(&path).map_err(|e| format!("cannot read {path}: {e}"))?;
    if is_link(&meta) {
        return Err("managed by the hub, remove it from the hub instead".into());
    }
    let src = safe_path(&path)?;
    if !src.is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    let label = resolved_skill_roots()
        .into_iter()
        .find(|(_, r)| src.parent() == Some(r.as_path()))
        .map(|(label, _)| label)
        .ok_or_else(|| {
            "only a skill folder directly inside a skill root can be removed".to_string()
        })?;
    trash_skill(&src, label)
}

/// Old name of `skill_transfer`, kept for callers that only copy into the hub.
#[tauri::command]
fn skill_copy_to_hub(src_path: String, name: String) -> Result<String, String> {
    skill_transfer(src_path, "hub".to_string(), name, true)
}

/// Runs a PowerShell script with `-NoProfile -ExecutionPolicy Bypass -File`, no console window.
/// `args` are passed one by one, so nothing a user types is ever parsed as a command.
fn run_powershell(script: &Path, args: &[String]) -> Result<std::process::Output, String> {
    if !script.is_file() {
        return Err(format!(
            "script not found: {} (check the paths in corvoid-hub.json)",
            script.display()
        ));
    }
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
    cmd.arg(script);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output()
        .map_err(|e| format!("cannot start powershell: {e}"))
}

fn output_text(out: &std::process::Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .trim()
    .to_string()
}

/// stdout, stderr and the exit code of a script. Quick log reads its own exit codes (0/3/4).
#[derive(Serialize)]
pub struct ProcessRun {
    stdout: String,
    stderr: String,
    code: i32,
}

/// Asks needle-log for a suggestion (it runs with -DryRun, so nothing is written).
#[tauri::command]
async fn quicklog_suggest(sentence: String) -> Result<ProcessRun, String> {
    let text = sentence.trim().to_string();
    if text.is_empty() {
        return Err("say what you did first".into());
    }
    let script = config()
        .needle_log
        .clone()
        .ok_or("quick log is off: set \"vlog\" and \"needleLog\" in corvoid-hub.json")?;
    tauri::async_runtime::spawn_blocking(move || {
        let out = run_powershell(&script, &[text, "-DryRun".to_string()])?;
        Ok(ProcessRun {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            code: out.status.code().unwrap_or(-1),
        })
    })
    .await
    .map_err(|e| format!("quick log task failed: {e}"))?
}

/// The project name of a `Projects/<Name>` folder: no separators or wildcards, never `.` or `..`.
fn valid_project_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name
            .chars()
            .any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

/// Logs one bullet with vlog.ps1, always as harness "me". The project folder must exist in the vault.
#[tauri::command]
async fn quicklog_commit(
    project: String,
    kind: String,
    text: String,
    task: Option<String>,
) -> Result<String, String> {
    if kind != "task" && kind != "update" {
        return Err("kind must be task or update".into());
    }
    let project = project.trim().to_string();
    if !valid_project_name(&project) {
        return Err(format!("not a project name: {project}"));
    }
    let folder = config().projects().join(&project);
    if !folder.is_dir() {
        return Err(format!("no project folder: {}", folder.display()));
    }
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("the log text is empty".into());
    }
    let task = task.unwrap_or_default().trim().to_string();
    let script = config()
        .vlog
        .clone()
        .ok_or("quick log is off: set \"vlog\" and \"needleLog\" in corvoid-hub.json")?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec![
            "-Project".to_string(),
            project,
            "-Kind".to_string(),
            kind,
            "-Text".to_string(),
            text,
            "-Harness".to_string(),
            "me".to_string(),
        ];
        if !task.is_empty() {
            args.push("-Task".into());
            args.push(task);
        }
        let out = run_powershell(&script, &args)?;
        let message = output_text(&out);
        if out.status.success() {
            Ok(message)
        } else {
            Err(format!("vlog exited with {}\n{message}", out.status))
        }
    })
    .await
    .map_err(|e| format!("quick log task failed: {e}"))?
}

/// Applies locks.yaml to disk (read-only bits and the Claude Code deny rules) and returns the script output.
#[tauri::command]
async fn apply_locks() -> Result<String, String> {
    let script = config().apply_locks();
    tauri::async_runtime::spawn_blocking(move || {
        let out = run_powershell(&script, &[])?;
        let message = output_text(&out);
        if out.status.success() {
            Ok(message)
        } else {
            Err(format!("apply-locks exited with {}\n{message}", out.status))
        }
    })
    .await
    .map_err(|e| format!("lock task failed: {e}"))?
}

#[tauri::command]
fn run_hub_sync() -> Result<String, String> {
    let script = config().hub_sync();
    if !script.is_file() {
        return Err(format!(
            "no hub-sync.ps1 in {} (set \"hub\" in corvoid-hub.json)",
            config().hub.display()
        ));
    }
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-File"]);
    cmd.arg(&script);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("cannot start powershell: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if out.status.success() {
        Ok(text)
    } else {
        Err(format!("hub-sync exited with {}\n{}", out.status, text))
    }
}

#[tauri::command]
fn skill_install_git(url: String, name: String) -> Result<String, String> {
    if !url.starts_with("https://github.com/") || url.chars().any(char::is_whitespace) {
        return Err("url must start with https://github.com/ and contain no spaces".into());
    }

    fs::create_dir_all(config().inbox()).map_err(|e| e.to_string())?;
    let dest = new_inbox_dest(&name)?;
    let dest_str = dest.to_string_lossy().into_owned();

    let mut cmd = Command::new("git");
    cmd.args(["clone", "--depth", "1", &url, &dest_str])
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("cannot start git: {e}"))?;
    if !out.status.success() {
        let _ = fs::remove_dir_all(&dest);
        return Err(format!(
            "git clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let intake = format!(
        "# Intake: {name}\n\n- Source: {url}\n- Date: {}\n- Method: git clone --depth 1\n\n## Notes\n\n",
        today_utc()
    );
    fs::write(dest.join("INTAKE.md"), intake).map_err(|e| format!("write INTAKE.md: {e}"))?;
    Ok(dest_str)
}

/// Copies a folder (recursively) or a single file from anywhere on disk into a new inbox item.
/// Symlinks, `.git`, and blocked folders are skipped so nothing outside the picked tree is pulled in.
fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let lower = name.to_string_lossy().to_lowercase();
        if BLOCKED_NAMES.contains(&lower.as_str()) || lower == ".git" {
            continue;
        }
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            continue;
        }
        let to = dst.join(&name);
        if ft.is_dir() {
            fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &to)?;
        } else if ft.is_file() {
            fs::copy(entry.path(), &to).map_err(|e| format!("copy {}: {e}", name.to_string_lossy()))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_into_inbox(src_path: String, name: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    let meta = fs::symlink_metadata(&src).map_err(|e| format!("cannot read {src_path}: {e}"))?;
    if meta.file_type().is_symlink() {
        return Err("symbolic links cannot be added; pick the real file or folder".into());
    }
    if !meta.is_dir() && !meta.is_file() {
        return Err(format!("not a file or folder: {src_path}"));
    }

    fs::create_dir_all(config().inbox()).map_err(|e| e.to_string())?;
    let dest = new_inbox_dest(&name)?;
    let dest_str = dest.to_string_lossy().into_owned();

    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let copied = if meta.is_dir() {
        copy_tree(&src, &dest)
    } else {
        match src.file_name() {
            Some(file_name) => fs::copy(&src, dest.join(file_name))
                .map(|_| ())
                .map_err(|e| format!("copy file: {e}")),
            None => Err(format!("no file name in {src_path}")),
        }
    };
    if let Err(e) = copied {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    let intake = format!(
        "# Intake: {name}\n\n- Source: {src_path}\n- Date: {}\n- Method: copied from local {}\n\n## Notes\n\n",
        today_utc(),
        if meta.is_dir() { "folder" } else { "file" }
    );
    fs::write(dest.join("INTAKE.md"), intake).map_err(|e| format!("write INTAKE.md: {e}"))?;
    Ok(dest_str)
}

/// Saves pasted text as inbox/<name>/SOURCE.md and writes INTAKE.md next to it.
#[tauri::command]
fn save_inbox_text(name: String, text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("the pasted text is empty".into());
    }
    fs::create_dir_all(config().inbox()).map_err(|e| e.to_string())?;
    let dest = new_inbox_dest(&name)?;
    let dest_str = dest.to_string_lossy().into_owned();

    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let written = fs::write(dest.join("SOURCE.md"), &text)
        .map_err(|e| format!("write SOURCE.md: {e}"))
        .and_then(|_| {
            let intake = format!(
                "# Intake: {name}\n\n- Source: pasted text\n- Date: {}\n- Method: pasted in Hub Dashboard\n\n## Notes\n\n",
                today_utc()
            );
            fs::write(dest.join("INTAKE.md"), intake).map_err(|e| format!("write INTAKE.md: {e}"))
        });
    if let Err(e) = written {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }
    Ok(dest_str)
}

fn external_navigation_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("external-navigation")
        .on_navigation(|webview, url| {
            let is_internal_host = matches!(
                url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("tauri.localhost") | Some("::1")
            );

            let is_internal = url.scheme() == "tauri" || is_internal_host;

            if is_internal {
                return true;
            }

            let is_external_link = matches!(url.scheme(), "http" | "https" | "mailto" | "tel");

            if is_external_link {
                log::info!("opening external link in system browser: {}", url);
                let _ = webview.opener().open_url(url.as_str(), None::<&str>);
                return false;
            }

            true
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_dir = config().log_dir.clone();
    let _ = fs::create_dir_all(&log_dir);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Folder {
                        path: log_dir,
                        file_name: None,
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(external_navigation_plugin())
        .invoke_handler(tauri::generate_handler![
            get_config,
            list_dir,
            read_text,
            write_text,
            delete_file,
            run_hub_sync,
            skill_install_git,
            copy_into_inbox,
            save_inbox_text,
            skill_roots,
            path_exists,
            resolve_path,
            skill_copy_to_hub,
            skill_transfer,
            skill_remove,
            quicklog_suggest,
            quicklog_commit,
            apply_locks
        ])
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                log::info!("main webview finished loading");
                let _ = webview.window().show();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
