use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::RwLock;
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
    /// Claude Code skill folder. Default: %USERPROFILE%\.claude\skills.
    claude_skills: Option<String>,
    /// Antigravity skill folder. Default: %USERPROFILE%\.gemini\config\skills.
    antigravity_skills: Option<String>,
    /// OpenCode config folder (opencode.json / opencode.jsonc). Default: %USERPROFILE%\.config\opencode.
    opencode_config: Option<String>,
    /// Antigravity.exe, used for its app icon. Default: the installed app, when there is one.
    antigravity_exe: Option<String>,
    /// Folder for backups. Default: <hub>\backups\corvoid.
    backup_dir: Option<String>,
    /// "daily", "weekly" or "off". Default: daily.
    auto_backup: Option<String>,
    /// How many backups to keep. Default: 10.
    keep_backups: Option<u32>,
}

/// Resolved paths, reloadable so Setup applies without a restart. Everything the app touches
/// derives from here.
#[derive(Clone)]
struct Config {
    hub: PathBuf,
    vault: PathBuf,
    log_dir: PathBuf,
    claude_skills: PathBuf,
    antigravity_skills: PathBuf,
    opencode_config: PathBuf,
    antigravity_exe: Option<PathBuf>,
    /// Where backups are written and listed.
    backup_dir: PathBuf,
    /// "daily", "weekly" or "off".
    auto_backup: String,
    /// Backups kept before the oldest are pruned.
    keep_backups: usize,
    vlog: Option<PathBuf>,
    needle_log: Option<PathBuf>,
    /// The config file that was used, or "defaults".
    source: String,
    /// The config file on disk, whether or not it could be read (None when there is no file).
    file_path: Option<String>,
    /// Modified time of that file, so get_config can notice a setup written by an agent.
    file_mtime: Option<u64>,
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
    /// True when a corvoid-hub.json was found (anything but the built-in defaults).
    fn configured(&self) -> bool {
        self.source != "defaults"
    }
    /// `<logDir>\..\icons`: the app's own cache folder, next to its logs.
    fn icons(&self) -> PathBuf {
        match self.log_dir.parent() {
            Some(parent) => parent.join("icons"),
            None => self.log_dir.join("icons"),
        }
    }
}

/// The loaded config. Reloaded by Setup and whenever get_config sees a new or edited file.
static CONFIG: RwLock<Option<Config>> = RwLock::new(None);

/// The current config (a clone, so callers never hold the lock).
fn config() -> Config {
    let cached = CONFIG.read().ok().and_then(|guard| guard.clone());
    cached.unwrap_or_else(reload_config)
}

/// Reads corvoid-hub.json again and makes it the active config.
fn reload_config() -> Config {
    let next = load_config();
    if let Ok(mut guard) = CONFIG.write() {
        *guard = Some(next.clone());
    }
    next
}

/// Reloads when the file on disk is not the one that was loaded, or is newer than it.
/// This is what lets Setup notice a config an AI agent just wrote.
fn refresh_if_changed() {
    let current = config();
    let on_disk = config_file();
    let same_file = match (&on_disk, &current.file_path) {
        (Some(path), Some(loaded)) => &path_text(path) == loaded,
        (None, None) => true,
        _ => false,
    };
    if !same_file {
        reload_config();
        return;
    }
    if let Some(path) = on_disk {
        let mtime = fs::metadata(&path).ok().and_then(|m| m.modified().ok()).and_then(unix_secs);
        if mtime != current.file_mtime {
            reload_config();
        }
    }
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
    let mut file_path = None;
    let mut file_mtime = None;
    if let Some(path) = config_file() {
        file_path = Some(path_text(&path));
        file_mtime = fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(unix_secs);
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
    // Before setup the hub may not exist: keep logs in the app's own folder, never create the hub.
    let log_dir = take(file.log_dir).unwrap_or_else(|| {
        if hub.is_dir() {
            hub.join(".logs")
        } else {
            env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.clone())
                .join("Corvoid Hub")
                .join("logs")
        }
    });
    let claude_skills = take(file.claude_skills)
        .unwrap_or_else(|| home.join(".claude").join("skills"));
    let antigravity_skills = take(file.antigravity_skills)
        .unwrap_or_else(|| home.join(".gemini").join("config").join("skills"));
    let opencode_config = take(file.opencode_config)
        .unwrap_or_else(|| home.join(".config").join("opencode"));
    let antigravity_exe = take(file.antigravity_exe).or_else(installed_antigravity_exe);
    let backup_dir = take(file.backup_dir).unwrap_or_else(|| hub.join("backups").join("corvoid"));
    let auto_backup = match file
        .auto_backup
        .map(|s| s.trim().to_lowercase())
        .as_deref()
    {
        Some("off") => "off",
        Some("weekly") => "weekly",
        _ => "daily",
    }
    .to_string();
    let keep_backups = file.keep_backups.unwrap_or(10).clamp(1, 100) as usize;

    Config {
        hub,
        vault,
        log_dir,
        claude_skills,
        antigravity_skills,
        opencode_config,
        antigravity_exe,
        backup_dir,
        auto_backup,
        keep_backups,
        vlog: take(file.vlog),
        needle_log: take(file.needle_log),
        source,
        file_path,
        file_mtime,
    }
}

/// The installed Antigravity app, when there is one: per-user install first, then machine-wide.
fn installed_antigravity_exe() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("Programs")
                .join("antigravity")
                .join("Antigravity.exe"),
        );
    }
    if let Some(programs) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(programs).join("Antigravity").join("Antigravity.exe"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Where setup writes corvoid-hub.json: CORVOID_HUB_CONFIG, else the file that is already in use,
/// else %USERPROFILE%\.corvoid-hub.json.
fn config_target_path() -> PathBuf {
    if let Some(raw) = env::var_os("CORVOID_HUB_CONFIG") {
        let p = PathBuf::from(raw);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    config_file().unwrap_or_else(|| user_home().join(format!(".{CONFIG_FILE_NAME}")))
}

/// Obsidian's own vault list, read from %APPDATA%\obsidian\obsidian.json. Read-only, and a
/// missing or broken file is simply no suggestion.
fn obsidian_vaults() -> Vec<String> {
    let Some(appdata) = env::var_os("APPDATA") else {
        return Vec::new();
    };
    let file = PathBuf::from(appdata).join("obsidian").join("obsidian.json");
    let Ok(text) = fs::read_to_string(file) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let mut out: Vec<String> = json
        .get("vaults")
        .and_then(|v| v.as_object())
        .map(|vaults| {
            vaults
                .values()
                .filter_map(|v| v.get("path").and_then(|p| p.as_str()))
                .map(|p| p.to_string())
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out.dedup();
    out
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
    claude_skills: String,
    antigravity_skills: String,
    opencode_config: String,
    antigravity_exe: Option<String>,
    /// Where backups are written and listed (default <hub>\backups\corvoid).
    backup_dir: String,
    /// "daily", "weekly" or "off".
    auto_backup: String,
    /// How many backups are kept.
    keep_backups: usize,
    vlog: Option<String>,
    needle_log: Option<String>,
    /// The config file that was read, or "defaults".
    source: String,
    /// True when a config file was found (setup is done).
    configured: bool,
    /// True when both vlog and needle-log are configured.
    quick_log: bool,
    hub_exists: bool,
    vault_exists: bool,
}

/// The paths every screen uses. Loaded by the frontend before the first render and again after setup.
#[tauri::command]
fn get_config() -> ConfigView {
    // Setup (or an agent running it) may have written the file after the app started.
    refresh_if_changed();
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
        claude_skills: path_text(&c.claude_skills),
        antigravity_skills: path_text(&c.antigravity_skills),
        opencode_config: path_text(&c.opencode_config),
        antigravity_exe: c.antigravity_exe.as_deref().map(path_text),
        backup_dir: path_text(&c.backup_dir),
        auto_backup: c.auto_backup.clone(),
        keep_backups: c.keep_backups,
        vlog: c.vlog.as_deref().map(path_text),
        needle_log: c.needle_log.as_deref().map(path_text),
        source: c.source.clone(),
        configured: c.configured(),
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

/// Canonical folders the app may touch: the hub, the vault, and the two harness skill folders.
/// They come from the config, so a moved harness folder stays reachable. Missing folders are skipped.
fn allowed_roots() -> Vec<PathBuf> {
    let c = config();
    let raw = [c.hub, c.vault, c.claude_skills, c.antigravity_skills];
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
    let c = config();
    SkillRoots {
        hub: path_text(&c.skills()),
        claude: Some(path_text(&c.claude_skills)),
        gemini: Some(path_text(&c.antigravity_skills)),
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

/// Raw skill folder of a target: `<hub>\skills`, the configured Claude Code or Antigravity folder.
fn skill_root_raw(target: &str) -> Result<PathBuf, String> {
    let c = config();
    match target {
        "hub" => Ok(c.skills()),
        "claude" => Ok(c.claude_skills),
        "gemini" => Ok(c.antigravity_skills),
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
    let c = config();
    let candidates = [
        ("hub", c.skills()),
        ("claude", c.claude_skills),
        ("gemini", c.antigravity_skills),
    ];
    let mut out = Vec::new();
    for (label, raw) in candidates {
        if let Ok(canon) = raw.canonicalize() {
            out.push((label, canon));
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

// ---------------------------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------------------------

// Starters copied into a fresh hub and vault. They are the examples, embedded so the installer
// needs no extra files. Existing files are never overwritten.
const STARTER_HUB_RULES: &str = include_str!("../../examples/hub/AGENTS.md");
const STARTER_CATEGORIES: &str = include_str!("../../examples/hub/categories.yaml");
const STARTER_GLOSSARY: &str = include_str!("../../examples/hub/glossary.yaml");
const STARTER_APPS: &str = include_str!("../../examples/hub/apps.yaml");
const STARTER_LOCKS: &str = include_str!("../../examples/hub/locks.yaml");
const STARTER_PROJECT_TEMPLATE: &str = include_str!("../../examples/vault/Templates/Project.md");

/// One path setup asks for: where it points now, and whether it is already on disk.
#[derive(Serialize)]
struct DetectPath {
    path: String,
    exists: bool,
}

impl DetectPath {
    fn of(path: &Path) -> Self {
        DetectPath {
            path: path_text(path),
            exists: path.exists(),
        }
    }
}

/// Everything the Setup dialog starts from. Read-only: nothing is written here.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupDetect {
    hub: DetectPath,
    vault: DetectPath,
    claude_skills: DetectPath,
    antigravity_skills: DetectPath,
    opencode_config: DetectPath,
    antigravity_exe: DetectPath,
    /// Vault paths found in Obsidian's own vault list (a suggestion, not a requirement).
    obsidian_vaults: Vec<String>,
    /// Where setup writes corvoid-hub.json.
    config_path: String,
    configured: bool,
}

#[tauri::command]
fn setup_detect() -> SetupDetect {
    refresh_if_changed();
    let c = config();
    let exe = c
        .antigravity_exe
        .clone()
        .map(|p| DetectPath::of(&p))
        .unwrap_or(DetectPath {
            path: String::new(),
            exists: false,
        });
    SetupDetect {
        hub: DetectPath::of(&c.hub),
        vault: DetectPath::of(&c.vault),
        claude_skills: DetectPath::of(&c.claude_skills),
        antigravity_skills: DetectPath::of(&c.antigravity_skills),
        opencode_config: DetectPath::of(&c.opencode_config),
        antigravity_exe: exe,
        obsidian_vaults: obsidian_vaults(),
        config_path: path_text(&config_target_path()),
        configured: c.configured(),
    }
}

/// Where setup writes corvoid-hub.json (and reads it back).
#[tauri::command]
fn config_path() -> String {
    path_text(&config_target_path())
}

/// The fields the Setup dialog sends. Empty = leave the default.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SetupFields {
    hub: Option<String>,
    vault: Option<String>,
    claude_skills: Option<String>,
    antigravity_skills: Option<String>,
    opencode_config: Option<String>,
    antigravity_exe: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupSaveResult {
    config_path: String,
    hub: String,
    vault: String,
    /// Files and folders the starter copy created (nothing that already existed).
    created: Vec<String>,
}

fn trim_opt(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Writes the config file, creates the hub and vault folders, and (optionally) copies the starters
/// that are missing. Keys the dialog does not show (vlog, needleLog, logDir) are kept as they are.
/// Then the config is reloaded, so the app uses the new paths without a restart.
#[tauri::command]
fn setup_save(fields: SetupFields, create_starters: bool) -> Result<SetupSaveResult, String> {
    let hub = trim_opt(fields.hub).ok_or("the hub folder is required")?;
    let vault = trim_opt(fields.vault).ok_or("the vault folder is required")?;
    let hub_path = PathBuf::from(&hub);
    let vault_path = PathBuf::from(&vault);
    if !hub_path.is_absolute() || !vault_path.is_absolute() {
        return Err("both folders must be absolute paths".into());
    }

    let target = config_target_path();
    let mut json: serde_json::Map<String, serde_json::Value> = fs::read_to_string(&target)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    json.insert("hub".into(), serde_json::Value::String(hub.clone()));
    json.insert("vault".into(), serde_json::Value::String(vault.clone()));
    for (key, value) in [
        ("claudeSkills", trim_opt(fields.claude_skills)),
        ("antigravitySkills", trim_opt(fields.antigravity_skills)),
        ("opencodeConfig", trim_opt(fields.opencode_config)),
        ("antigravityExe", trim_opt(fields.antigravity_exe)),
    ] {
        match value {
            Some(text) => {
                json.insert(key.to_string(), serde_json::Value::String(text));
            }
            None => {
                json.remove(key);
            }
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(&serde_json::Value::Object(json))
        .map_err(|e| format!("build the config: {e}"))?;
    fs::write(&target, format!("{text}\n"))
        .map_err(|e| format!("write {}: {e}", target.display()))?;

    fs::create_dir_all(&hub_path).map_err(|e| format!("create {}: {e}", hub_path.display()))?;
    fs::create_dir_all(&vault_path)
        .map_err(|e| format!("create {}: {e}", vault_path.display()))?;

    let mut created = Vec::new();
    if create_starters {
        created = write_starters(&hub_path, &vault_path)?;
    }
    reload_config();

    Ok(SetupSaveResult {
        config_path: path_text(&target),
        hub,
        vault,
        created,
    })
}

/// Copies the starter files and folders that are missing. Never overwrites anything.
fn write_starters(hub: &Path, vault: &Path) -> Result<Vec<String>, String> {
    let mut created = Vec::new();
    let hub_files: [(&str, &str); 5] = [
        ("AGENTS.md", STARTER_HUB_RULES),
        ("categories.yaml", STARTER_CATEGORIES),
        ("glossary.yaml", STARTER_GLOSSARY),
        ("apps.yaml", STARTER_APPS),
        ("locks.yaml", STARTER_LOCKS),
    ];
    for (rel, content) in hub_files {
        let path = hub.join(rel);
        if !path.exists() {
            fs::write(&path, content).map_err(|e| format!("write {}: {e}", path.display()))?;
            created.push(path_text(&path));
        }
    }
    for rel in ["skills", "packs"] {
        let dir = hub.join(rel);
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
            created.push(path_text(&dir));
        }
    }
    for rel in ["Projects", "Log"] {
        let dir = vault.join(rel);
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
            created.push(path_text(&dir));
        }
    }
    let template = vault.join("Templates").join("Project.md");
    if !template.exists() {
        if let Some(parent) = template.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        fs::write(&template, STARTER_PROJECT_TEMPLATE)
            .map_err(|e| format!("write {}: {e}", template.display()))?;
        created.push(path_text(&template));
    }
    Ok(created)
}

/// One harness the rules were connected to.
#[derive(Serialize)]
pub struct WireResult {
    harness: String,
    ok: bool,
    /// File or folder that was touched.
    path: String,
    message: String,
}

/// Copies the hub rules next to a file, so an edit can always be undone: `<name>.bak-YYYYMMDD-HHMMSS`.
fn backup_file(path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .ok_or_else(|| format!("no file name in {}", path.display()))?
        .to_string_lossy()
        .into_owned();
    let dest = path.with_file_name(format!("{name}.bak-{}", utc_stamp()));
    fs::copy(path, &dest).map_err(|e| format!("backup {}: {e}", path.display()))?;
    Ok(dest)
}

/// Lowercase, forward slashes, no trailing slash: for comparing config paths.
fn norm_path_text(text: &str) -> String {
    text.replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

/// Drops `//` and `/* */` comments and trailing commas, so opencode.jsonc can be read and rewritten
/// as plain JSON. Strings are left untouched.
fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                while let Some(n) = chars.next() {
                    if n == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut prev = '\0';
                while let Some(n) = chars.next() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
            }
            _ => out.push(c),
        }
    }

    let chars: Vec<char> = out.chars().collect();
    let mut cleaned = String::with_capacity(out.len());
    let mut in_string = false;
    let mut escaped = false;
    for (i, &ch) in chars.iter().enumerate() {
        if in_string {
            cleaned.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            cleaned.push(ch);
            continue;
        }
        if ch == ',' {
            if let Some(next) = chars[i + 1..].iter().find(|c| !c.is_whitespace()) {
                if *next == '}' || *next == ']' {
                    continue;
                }
            }
        }
        cleaned.push(ch);
    }
    cleaned
}

fn wire_claude(c: &Config, rules: &Path) -> Result<(PathBuf, String), String> {
    let dir = c
        .claude_skills
        .parent()
        .ok_or("the Claude Code skills folder has no parent")?;
    if !dir.is_dir() {
        return Err(format!("no Claude Code folder at {}", dir.display()));
    }
    let file = dir.join("CLAUDE.md");
    let line = format!("@{}", path_text(rules));
    let existing = fs::read_to_string(&file).unwrap_or_default();
    if file.is_file() && existing.lines().any(|l| l.trim().eq_ignore_ascii_case(&line)) {
        return Ok((file, "already connected".into()));
    }
    if file.is_file() {
        backup_file(&file)?;
    }
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&line);
    text.push('\n');
    fs::write(&file, text).map_err(|e| format!("write {}: {e}", file.display()))?;
    Ok((file, format!("added {line}")))
}

fn opencode_file(dir: &Path) -> PathBuf {
    let plain = dir.join("opencode.json");
    if plain.is_file() {
        return plain;
    }
    let jsonc = dir.join("opencode.jsonc");
    if jsonc.is_file() {
        return jsonc;
    }
    plain
}

fn wire_opencode(c: &Config, rules: &Path) -> Result<(PathBuf, String), String> {
    let dir = &c.opencode_config;
    if !dir.is_dir() {
        return Err(format!("no OpenCode config folder at {}", dir.display()));
    }
    let file = opencode_file(dir);
    let raw = if file.is_file() {
        fs::read_to_string(&file).map_err(|e| format!("read {}: {e}", file.display()))?
    } else {
        "{}".to_string()
    };
    let mut value: serde_json::Value = serde_json::from_str(&raw)
        .or_else(|_| serde_json::from_str(&strip_jsonc(&raw)))
        .map_err(|e| format!("cannot read {} as JSON: {e}", file.display()))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| format!("{} is not a JSON object", file.display()))?;
    let entry = path_text(rules);
    if !obj.contains_key("instructions") {
        obj.insert(
            "instructions".into(),
            serde_json::Value::Array(Vec::new()),
        );
    }
    let list = obj
        .get_mut("instructions")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| format!("\"instructions\" in {} is not a list", file.display()))?;
    if list
        .iter()
        .filter_map(|v| v.as_str())
        .any(|s| norm_path_text(s) == norm_path_text(&entry))
    {
        return Ok((file, "already connected".into()));
    }
    if file.is_file() {
        backup_file(&file)?;
    }
    list.push(serde_json::Value::String(entry.clone()));
    let text = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("write {}: {e}", file.display()))?;
    fs::write(&file, format!("{text}\n")).map_err(|e| format!("write {}: {e}", file.display()))?;
    Ok((file, format!("added {entry} to instructions")))
}

fn wire_antigravity(c: &Config, rules: &Path) -> Result<(PathBuf, String), String> {
    let config_dir = c
        .antigravity_skills
        .parent()
        .ok_or("the Antigravity skills folder has no parent")?;
    if !config_dir.is_dir() {
        return Err(format!("no Antigravity config folder at {}", config_dir.display()));
    }
    let plugin = config_dir.join("plugins").join("corvoid-hub");
    let manifest = plugin.join("plugin.json");
    let plugin_rules = plugin.join("rules").join("AGENTS.md");
    if manifest.is_file() && plugin_rules.is_file() {
        return Ok((plugin, "already connected".into()));
    }
    fs::create_dir_all(plugin.join("rules"))
        .map_err(|e| format!("create {}: {e}", plugin.display()))?;
    if !manifest.is_file() {
        let body = "{\n  \"name\": \"corvoid-hub\",\n  \"version\": \"1.0.0\",\n  \"description\": \"Corvoid Hub global rules\"\n}\n";
        fs::write(&manifest, body).map_err(|e| format!("write {}: {e}", manifest.display()))?;
    }
    if !plugin_rules.is_file() {
        fs::copy(rules, &plugin_rules)
            .map_err(|e| format!("copy rules to {}: {e}", plugin_rules.display()))?;
    }
    Ok((plugin, "plugin created".into()))
}

/// Connects the hub rules to each harness whose folder exists: an import line in CLAUDE.md, an
/// `instructions` entry in OpenCode's config, or a plugin folder for Antigravity. Existing files are
/// backed up next to themselves, and a harness that is already connected is left alone.
#[tauri::command]
fn setup_wire_rules(harnesses: Vec<String>) -> Result<Vec<WireResult>, String> {
    let c = config();
    let rules = c.hub.join("AGENTS.md");
    if !rules.is_file() {
        return Err(format!(
            "no AGENTS.md in {}: create the hub starters first",
            c.hub.display()
        ));
    }
    let mut out = Vec::new();
    for harness in harnesses {
        let wired = match harness.as_str() {
            "claude-code" => wire_claude(&c, &rules),
            "opencode" => wire_opencode(&c, &rules),
            "antigravity" => wire_antigravity(&c, &rules),
            other => Err(format!("unknown harness: {other}")),
        };
        out.push(match wired {
            Ok((path, message)) => WireResult {
                harness,
                ok: true,
                path: path_text(&path),
                message,
            },
            Err(message) => WireResult {
                harness,
                ok: false,
                path: String::new(),
                message,
            },
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------------------------

const BACKUP_PREFIX: &str = "corvoid-backup-";
/// Files above this size are left out of a backup and named in the manifest.
const BACKUP_MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const SECS_PER_DAY: u64 = 86_400;

/// True for the files this module writes: corvoid-backup-YYYYMMDD-HHMMSS.zip. Pruning only ever
/// touches files that match, so anything else in the backup folder is left alone.
fn is_backup_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with(BACKUP_PREFIX) && lower.ends_with(".zip")
}

fn unique_child(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}{ext}"));
        n += 1;
    }
    path
}

/// UTC timestamp in ISO 8601, from the same clock as utc_stamp.
fn utc_iso_now() -> String {
    let stamp = utc_stamp();
    format!(
        "{}-{}-{}T{}:{}:{}Z",
        &stamp[0..4],
        &stamp[4..6],
        &stamp[6..8],
        &stamp[9..11],
        &stamp[11..13],
        &stamp[13..15]
    )
}

#[derive(Clone, Copy, PartialEq)]
enum BackupPart {
    Hub,
    Vault,
}

/// Folders a backup never enters. The hub keeps build output, git history, removed skills and its
/// own logs; a folder named `app` that holds a package.json is an app repo, not hub data.
/// The vault keeps only its own folders and root notes, and never Obsidian's state.
fn skip_backup_dir(part: BackupPart, path: &Path, name_lower: &str) -> bool {
    if BLOCKED_NAMES.contains(&name_lower) || name_lower == ".trash" {
        return true;
    }
    match part {
        BackupPart::Hub => {
            matches!(
                name_lower,
                "node_modules" | "target" | "dist" | ".git" | "backups" | ".logs"
            ) || (name_lower == "app" && path.join("package.json").is_file())
        }
        BackupPart::Vault => false,
    }
}

/// Streams one backup into a zip: `hub/`, `vault/`, the active config and a manifest. Files over
/// BACKUP_MAX_FILE_BYTES are skipped and named in the manifest. Resolves with the file count.
struct BackupRun {
    zip: zip::ZipWriter<std::io::BufWriter<fs::File>>,
    options: zip::write::SimpleFileOptions,
    files: usize,
    skipped: Vec<String>,
}

impl BackupRun {
    fn add_file(&mut self, src: &Path, name: &str) -> Result<(), String> {
        let meta = fs::metadata(src).map_err(|e| format!("read {}: {e}", src.display()))?;
        if meta.len() > BACKUP_MAX_FILE_BYTES {
            self.skipped.push(format!(
                "{name} ({:.1} MB)",
                meta.len() as f64 / (1024.0 * 1024.0)
            ));
            return Ok(());
        }
        let mut file = fs::File::open(src).map_err(|e| format!("read {}: {e}", src.display()))?;
        self.zip
            .start_file(name, self.options)
            .map_err(|e| format!("zip {name}: {e}"))?;
        std::io::copy(&mut file, &mut self.zip).map_err(|e| format!("zip {name}: {e}"))?;
        self.files += 1;
        Ok(())
    }

    /// Adds a folder and its contents under `prefix` (forward slashes, no trailing one).
    fn add_dir(&mut self, src: &Path, prefix: &str, part: BackupPart) -> Result<(), String> {
        self.zip
            .add_directory(format!("{prefix}/"), self.options)
            .map_err(|e| format!("zip folder {prefix}: {e}"))?;
        let read = fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))?;
        let mut entries: Vec<fs::DirEntry> = read.filter_map(Result::ok).collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            let Ok(meta) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            // Links are never followed: a backup holds what really lives in the hub and vault.
            if is_link(&meta) {
                continue;
            }
            let child = format!("{prefix}/{name}");
            if meta.is_dir() {
                if skip_backup_dir(part, &entry.path(), &lower) {
                    continue;
                }
                self.add_dir(&entry.path(), &child, part)?;
            } else if meta.is_file() {
                self.add_file(&entry.path(), &child)?;
            }
        }
        Ok(())
    }

    /// The vault part: Projects, Log, Templates, _system and the root notes. Nothing else.
    fn add_vault(&mut self, vault: &Path) -> Result<(), String> {
        for name in ["Projects", "Log", "Templates", "_system"] {
            let dir = vault.join(name);
            if dir.is_dir() {
                self.add_dir(&dir, &format!("vault/{name}"), BackupPart::Vault)?;
            }
        }
        let read = fs::read_dir(vault).map_err(|e| format!("read {}: {e}", vault.display()))?;
        let mut notes: Vec<fs::DirEntry> = read
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            })
            .collect();
        notes.sort_by_key(|entry| entry.file_name());
        for entry in notes {
            let Ok(meta) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if meta.is_file() && !is_link(&meta) {
                let name = entry.file_name().to_string_lossy().into_owned();
                self.add_file(&entry.path(), &format!("vault/{name}"))?;
            }
        }
        Ok(())
    }
}

fn build_backup_inner(c: &Config, dest: &Path) -> Result<usize, String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let file = fs::File::create(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut run = BackupRun {
        zip: zip::ZipWriter::new(std::io::BufWriter::new(file)),
        options: zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated),
        files: 0,
        skipped: Vec::new(),
    };

    if c.hub.is_dir() {
        run.add_dir(&c.hub, "hub", BackupPart::Hub)?;
    }
    if c.vault.is_dir() {
        run.zip
            .add_directory("vault/", run.options)
            .map_err(|e| format!("zip folder vault: {e}"))?;
        run.add_vault(&c.vault)?;
    }
    if let Some(raw) = &c.file_path {
        let source = PathBuf::from(raw);
        if source.is_file() {
            run.add_file(&source, "corvoid-hub.json")?;
        }
    }

    let manifest = serde_json::json!({
        "app": env!("CARGO_PKG_VERSION"),
        "created": utc_iso_now(),
        "hub": path_text(&c.hub),
        "vault": path_text(&c.vault),
        "files": run.files,
        "skipped": run.skipped,
    });
    let text = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("build the manifest: {e}"))?;
    run.zip
        .start_file("manifest.json", run.options)
        .map_err(|e| format!("zip manifest: {e}"))?;
    run.zip
        .write_all(text.as_bytes())
        .map_err(|e| format!("zip manifest: {e}"))?;

    let files = run.files;
    run.zip.finish().map_err(|e| format!("finish {}: {e}", dest.display()))?;
    Ok(files)
}

/// Writes a backup, removing a half-written zip when anything fails.
fn build_backup(c: &Config, dest: &Path) -> Result<usize, String> {
    match build_backup_inner(c, dest) {
        Ok(files) => Ok(files),
        Err(e) => {
            let _ = fs::remove_file(dest);
            Err(e)
        }
    }
}

/// Where a new backup goes: the path from the save dialog, or a timestamped name in backupDir.
fn backup_destination(c: &Config, dest_path: Option<String>) -> Result<PathBuf, String> {
    match dest_path.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(raw) => {
            let path = PathBuf::from(&raw);
            if !path.is_absolute() {
                return Err(format!("the destination must be an absolute path: {raw}"));
            }
            if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
            {
                Ok(path)
            } else {
                let mut name = path.into_os_string();
                name.push(".zip");
                Ok(PathBuf::from(name))
            }
        }
        None => {
            fs::create_dir_all(&c.backup_dir)
                .map_err(|e| format!("create {}: {e}", c.backup_dir.display()))?;
            Ok(unique_child(
                &c.backup_dir,
                &format!("{BACKUP_PREFIX}{}", utc_stamp()),
                ".zip",
            ))
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCreated {
    path: String,
    size: u64,
    files: usize,
}

/// Writes one backup now: into `dest_path` when the save dialog picked a file, else into backupDir.
#[tauri::command]
async fn backup_create(dest_path: Option<String>) -> Result<BackupCreated, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let c = config();
        let dest = backup_destination(&c, dest_path)?;
        let files = build_backup(&c, &dest)?;
        let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        Ok(BackupCreated {
            path: strip_verbatim(&dest),
            size,
            files,
        })
    })
    .await
    .map_err(|e| format!("backup task failed: {e}"))?
}

#[derive(Serialize)]
pub struct BackupEntry {
    path: String,
    size: u64,
    /// Modified time as unix seconds.
    created: u64,
}

/// The backups in backupDir, newest first. Only files named like a backup are listed.
#[tauri::command]
fn backup_list() -> Result<Vec<BackupEntry>, String> {
    let c = config();
    if !c.backup_dir.is_dir() {
        return Ok(Vec::new());
    }
    let read = fs::read_dir(&c.backup_dir)
        .map_err(|e| format!("read {}: {e}", c.backup_dir.display()))?;
    let mut out = Vec::new();
    for entry in read.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_backup_name(&name) {
            continue;
        }
        let Ok(meta) = fs::metadata(entry.path()) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        out.push(BackupEntry {
            path: strip_verbatim(&entry.path()),
            size: meta.len(),
            created: meta.modified().ok().and_then(unix_secs).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| {
        b.created
            .cmp(&a.created)
            .then_with(|| b.path.cmp(&a.path))
    });
    Ok(out)
}

/// Extracts a backup into `dest`. Entries with `..` or an absolute path are refused, so a zip can
/// never write outside its own folder.
fn extract_backup(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("read {}: {e}", zip_path.display()))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("read {}: {e}", zip_path.display()))?;
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut files = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("read entry {i}: {e}"))?;
        let Some(rel) = entry.enclosed_name() else {
            log::warn!("skipping unsafe backup entry: {}", entry.name());
            continue;
        };
        if rel.components().any(|comp| {
            matches!(
                comp,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            log::warn!("skipping unsafe backup entry: {}", entry.name());
            continue;
        }
        let out = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| format!("create {}: {e}", out.display()))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let mut target =
            fs::File::create(&out).map_err(|e| format!("create {}: {e}", out.display()))?;
        std::io::copy(&mut entry, &mut target)
            .map_err(|e| format!("write {}: {e}", out.display()))?;
        files += 1;
    }
    if files == 0 {
        return Err("the backup has no files".into());
    }
    Ok(())
}

/// Restores into a new folder: the current state is backed up first ("pre-restore"), then the zip
/// is extracted into `<backupDir>\restore-YYYYMMDD-HHMMSS`. Nothing in place is overwritten.
#[tauri::command]
async fn backup_restore(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let c = config();
        let zip_path = PathBuf::from(path.trim());
        let name = zip_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !is_backup_name(&name) {
            return Err(format!("not a Corvoid backup: {name}"));
        }
        if !zip_path.is_file() {
            return Err(format!("backup not found: {}", zip_path.display()));
        }

        let safety = backup_destination(&c, None)?;
        let files = build_backup(&c, &safety)?;
        log::info!(
            "pre-restore backup {} ({} files)",
            safety.display(),
            files
        );

        fs::create_dir_all(&c.backup_dir)
            .map_err(|e| format!("create {}: {e}", c.backup_dir.display()))?;
        let folder = unique_child(
            &c.backup_dir,
            &format!("restore-{}", utc_stamp()),
            "",
        );
        extract_backup(&zip_path, &folder)?;
        Ok(strip_verbatim(&folder))
    })
    .await
    .map_err(|e| format!("restore task failed: {e}"))?
}

/// Options the Backups tab changes. Optional keys with defaults, like the rest of the config.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    auto_backup: String,
    keep_backups: u32,
}

/// Reads the config file as a JSON object (empty when there is none yet).
fn config_json_object(target: &Path) -> serde_json::Map<String, serde_json::Value> {
    fs::read_to_string(target)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_config_json(
    target: &Path,
    json: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(&serde_json::Value::Object(json.clone()))
        .map_err(|e| format!("build the config: {e}"))?;
    fs::write(target, format!("{text}\n"))
        .map_err(|e| format!("write {}: {e}", target.display()))
}

/// Saves autoBackup and keepBackups into corvoid-hub.json and reloads it, so the schedule applies
/// without a restart.
#[tauri::command]
fn backup_settings(settings: BackupSettings) -> Result<(), String> {
    let auto = settings.auto_backup.trim().to_lowercase();
    if !matches!(auto.as_str(), "daily" | "weekly" | "off") {
        return Err("autoBackup must be daily, weekly or off".into());
    }
    let keep = settings.keep_backups.clamp(1, 100);
    let target = config_target_path();
    let mut json = config_json_object(&target);
    json.insert("autoBackup".into(), serde_json::Value::String(auto));
    json.insert("keepBackups".into(), serde_json::Value::from(keep));
    write_config_json(&target, &json)?;
    reload_config();
    Ok(())
}

#[derive(Serialize)]
pub struct BackupAdopt {
    hub: String,
    vault: String,
}

/// Makes a restored folder the active hub and vault by changing the two config paths only. No files
/// are moved or copied. The current backupDir is written out when the config had no key for it, so
/// future backups stay where they are.
#[tauri::command]
fn backup_adopt(folder: String) -> Result<BackupAdopt, String> {
    let folder = PathBuf::from(folder.trim());
    if !folder.is_absolute() {
        return Err(format!("the folder must be an absolute path: {}", folder.display()));
    }
    let hub = folder.join("hub");
    let vault = folder.join("vault");
    if !hub.is_dir() {
        return Err(format!("no hub folder in {}", folder.display()));
    }
    if !vault.is_dir() {
        return Err(format!("no vault folder in {}", folder.display()));
    }
    let target = config_target_path();
    let mut json = config_json_object(&target);
    if !json.contains_key("backupDir") {
        json.insert(
            "backupDir".into(),
            serde_json::Value::String(path_text(&config().backup_dir)),
        );
    }
    json.insert("hub".into(), serde_json::Value::String(path_text(&hub)));
    json.insert("vault".into(), serde_json::Value::String(path_text(&vault)));
    write_config_json(&target, &json)?;
    reload_config();
    Ok(BackupAdopt {
        hub: path_text(&hub),
        vault: path_text(&vault),
    })
}

/// True when the newest backup is older than the configured interval.
fn auto_backup_due(c: &Config, now: u64) -> bool {
    let age = if c.auto_backup == "weekly" {
        7 * SECS_PER_DAY
    } else {
        SECS_PER_DAY
    };
    let newest = fs::read_dir(&c.backup_dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| is_backup_name(&entry.file_name().to_string_lossy()))
        .filter_map(|entry| entry.metadata().ok()?.modified().ok().and_then(unix_secs))
        .max();
    match newest {
        Some(time) => now.saturating_sub(time) >= age,
        None => true,
    }
}

/// Deletes the oldest backups beyond keepBackups. Only files that match the backup name pattern.
fn prune_backups(c: &Config) {
    let Ok(read) = fs::read_dir(&c.backup_dir) else {
        return;
    };
    let mut found: Vec<(u64, PathBuf)> = read
        .filter_map(Result::ok)
        .filter(|entry| {
            is_backup_name(&entry.file_name().to_string_lossy()) && entry.path().is_file()
        })
        .map(|entry| {
            let created = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(unix_secs)
                .unwrap_or(0);
            (created, entry.path())
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, path) in found.into_iter().skip(c.keep_backups.max(1)) {
        if let Err(e) = fs::remove_file(&path) {
            log::warn!("prune {}: {e}", path.display());
        }
    }
}

/// Runs on its own thread at app start: writes a backup when the newest one is older than the
/// interval (daily or weekly) and prunes the oldest beyond keepBackups.
fn run_auto_backup() -> Result<(), String> {
    let c = config();
    if !c.configured() || c.auto_backup == "off" || !c.hub.is_dir() {
        return Ok(());
    }
    let now = unix_secs(SystemTime::now()).unwrap_or(0);
    if auto_backup_due(&c, now) {
        let dest = backup_destination(&c, None)?;
        let files = build_backup(&c, &dest)?;
        log::info!("auto backup {} ({files} files)", dest.display());
    }
    prune_backups(&c);
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Harness app icon
// ---------------------------------------------------------------------------------------------

/// A single-quoted PowerShell string literal. Paths are data, never code.
fn ps_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// Runs inline PowerShell (`-Command`) for the one job that has no script of its own: reading an
/// app icon through System.Drawing.
fn run_powershell_command(script: &str) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output()
        .map_err(|e| format!("cannot start powershell: {e}"))
}

fn base64(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(ALPHABET[(b0 >> 2) as usize] as char);
        out.push(ALPHABET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Reads the icon out of an exe and writes it as a PNG.
fn extract_icon(exe: &Path, png: &Path) -> Result<(), String> {
    let script = format!(
        "Add-Type -AssemblyName System.Drawing; $icon = [System.Drawing.Icon]::ExtractAssociatedIcon({}); if ($icon -eq $null) {{ exit 2 }}; $icon.ToBitmap().Save({}, [System.Drawing.Imaging.ImageFormat]::Png)",
        ps_quote(&path_text(exe)),
        ps_quote(&path_text(png))
    );
    let out = run_powershell_command(&script)?;
    if !out.status.success() {
        return Err(format!(
            "extract from {}: {}",
            exe.display(),
            output_text(&out)
        ));
    }
    if !png.is_file() {
        return Err("the icon file was not written".into());
    }
    Ok(())
}

/// The app icon of a harness as a data URL, read from its installed exe and cached in
/// `<logDir>\..\icons\<name>.png` (regenerated when the exe is newer). Only Antigravity ships one;
/// Claude Code and OpenCode keep their simple-icons glyphs, so they get None.
#[tauri::command]
fn harness_icon(name: String) -> Option<String> {
    if name != "antigravity" {
        return None;
    }
    let c = config();
    let exe = c.antigravity_exe.clone()?;
    if !exe.is_file() {
        return None;
    }
    let dir = c.icons();
    let png = dir.join("antigravity.png");
    let stale = match (
        fs::metadata(&png).and_then(|m| m.modified()),
        fs::metadata(&exe).and_then(|m| m.modified()),
    ) {
        (Ok(cached), Ok(app)) => cached < app,
        _ => true,
    };
    if stale {
        if let Err(e) = fs::create_dir_all(&dir) {
            log::warn!("icon cache folder {}: {e}", dir.display());
            return None;
        }
        if let Err(e) = extract_icon(&exe, &png) {
            log::warn!("antigravity icon: {e}");
            return None;
        }
    }
    match fs::read(&png) {
        Ok(bytes) => Some(format!("data:image/png;base64,{}", base64(&bytes))),
        Err(e) => {
            log::warn!("read {}: {e}", png.display());
            None
        }
    }
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

    // The first backup of the day does not hold up the window: it runs on its own thread.
    std::thread::spawn(|| {
        if let Err(e) = run_auto_backup() {
            log::warn!("auto backup: {e}");
        }
    });

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
            apply_locks,
            setup_detect,
            setup_save,
            setup_wire_rules,
            config_path,
            harness_icon,
            backup_create,
            backup_list,
            backup_restore,
            backup_settings,
            backup_adopt
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

