use crate::models::{
    InstalledPlugin, PluginBackendManifest, PluginFrontendDocument, PluginInstallDialogResult,
    PluginManifest,
};
use anyhow::{Context, Result, anyhow, bail, ensure};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;
use zip::ZipArchive;

pub const PLUGIN_PACKAGE_EXTENSION: &str = "zszc-plugin";
pub const HOST_API_VERSION: u32 = 1;
pub const HOST_VERSION: &str = "0.1.0";

const PLUGINS_DIR_NAME: &str = "plugins";
const PLUGIN_DATA_DIR_NAME: &str = "plugin_data";
const PLUGIN_STAGING_DIR_NAME: &str = "plugin_staging";
const PLUGIN_MANIFEST_FILE_NAME: &str = "plugin.json";
const PLUGIN_WORKSPACE_MODE: &str = "full_workspace";

#[derive(Default)]
struct PluginRuntimeRegistry {
    inner: Mutex<HashMap<String, Arc<AsyncMutex<PluginRuntime>>>>,
}

struct PluginRuntime {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub struct PluginHost {
    plugins_dir: PathBuf,
    plugin_data_dir: PathBuf,
    staging_dir: PathBuf,
    current_platform: String,
    runtimes: PluginRuntimeRegistry,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct PluginRpcRequest<'a> {
    id: &'a str,
    method: &'a str,
    params: &'a JsonValue,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PluginRpcResponse {
    id: String,
    result: Option<JsonValue>,
    error: Option<PluginRpcError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PluginRpcError {
    message: String,
}

impl PluginHost {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        let plugins_dir = app_data_dir.join(PLUGINS_DIR_NAME);
        let plugin_data_dir = app_data_dir.join(PLUGIN_DATA_DIR_NAME);
        let staging_dir = app_data_dir.join(PLUGIN_STAGING_DIR_NAME);

        fs::create_dir_all(&plugins_dir).context("无法创建插件安装目录")?;
        fs::create_dir_all(&plugin_data_dir).context("无法创建插件数据目录")?;
        fs::create_dir_all(&staging_dir).context("无法创建插件暂存目录")?;

        Ok(Self {
            plugins_dir,
            plugin_data_dir,
            staging_dir,
            current_platform: current_platform(),
            runtimes: PluginRuntimeRegistry::default(),
        })
    }

    pub fn current_platform(&self) -> &str {
        &self.current_platform
    }

    pub fn list_installed_plugins(&self) -> Result<Vec<InstalledPlugin>> {
        let mut plugins = Vec::new();

        for entry in fs::read_dir(&self.plugins_dir).context("无法读取插件目录")? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let plugin_dir = entry.path();
            match self.load_installed_plugin(&plugin_dir) {
                Ok(plugin) => plugins.push(plugin),
                Err(error) => {
                    tracing::warn!(
                        plugin_dir = %plugin_dir.display(),
                        error = %error,
                        "skipped invalid plugin"
                    );
                }
            }
        }

        plugins.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        Ok(plugins)
    }

    pub fn install_from_package(&self, package_path: &Path) -> Result<InstalledPlugin> {
        ensure!(
            package_path.exists(),
            "插件安装包不存在: {}",
            package_path.display()
        );
        ensure!(
            package_path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(PLUGIN_PACKAGE_EXTENSION)),
            "插件安装包格式错误，仅支持 .{PLUGIN_PACKAGE_EXTENSION}"
        );

        let staging_root = self
            .staging_dir
            .join(format!("plugin-{}", Uuid::new_v4().simple()));
        fs::create_dir_all(&staging_root).context("无法创建插件暂存目录")?;

        let install_result = (|| -> Result<InstalledPlugin> {
            extract_plugin_package(package_path, &staging_root)?;
            let plugin_root = resolve_plugin_root(&staging_root)?;
            let manifest = read_plugin_manifest(&plugin_root)?;
            self.validate_manifest(&manifest, &plugin_root)?;

            let install_dir = self.plugins_dir.join(&manifest.id);
            if install_dir.exists() {
                self.stop_runtime(&manifest.id)?;
                fs::remove_dir_all(&install_dir)
                    .with_context(|| format!("无法移除旧插件目录: {}", install_dir.display()))?;
            }

            if plugin_root == staging_root {
                fs::rename(&staging_root, &install_dir).with_context(|| {
                    format!(
                        "无法安装插件目录: {} -> {}",
                        staging_root.display(),
                        install_dir.display()
                    )
                })?;
            } else {
                fs::rename(&plugin_root, &install_dir).with_context(|| {
                    format!(
                        "无法安装插件目录: {} -> {}",
                        plugin_root.display(),
                        install_dir.display()
                    )
                })?;
                let _ = fs::remove_dir_all(&staging_root);
            }

            fs::create_dir_all(self.plugin_data_dir.join(&manifest.id))
                .with_context(|| format!("无法创建插件数据目录: {}", manifest.id))?;

            self.load_installed_plugin(&install_dir)
        })();

        if staging_root.exists() {
            let _ = fs::remove_dir_all(&staging_root);
        }

        install_result
    }

    pub fn uninstall(&self, plugin_id: &str) -> Result<()> {
        validate_plugin_id(plugin_id)?;
        self.stop_runtime(plugin_id)?;

        let install_dir = self.plugins_dir.join(plugin_id);
        if install_dir.exists() {
            fs::remove_dir_all(&install_dir)
                .with_context(|| format!("无法移除插件目录: {}", install_dir.display()))?;
        }

        let plugin_data_dir = self.plugin_data_dir.join(plugin_id);
        if plugin_data_dir.exists() {
            fs::remove_dir_all(&plugin_data_dir)
                .with_context(|| format!("无法移除插件数据目录: {}", plugin_data_dir.display()))?;
        }

        Ok(())
    }

    pub fn read_frontend_document(&self, plugin_id: &str) -> Result<PluginFrontendDocument> {
        validate_plugin_id(plugin_id)?;

        let plugin_dir = self.plugins_dir.join(plugin_id);
        ensure!(plugin_dir.exists(), "插件不存在: {plugin_id}");

        let manifest = read_plugin_manifest(&plugin_dir)?;
        self.validate_manifest(&manifest, &plugin_dir)?;

        let frontend_path = plugin_dir.join(&manifest.frontend_entry);
        let html = build_frontend_document(&frontend_path)?;

        Ok(PluginFrontendDocument { html })
    }

    pub async fn backend_rpc(
        &self,
        plugin_id: &str,
        method: &str,
        params: JsonValue,
    ) -> Result<JsonValue> {
        validate_plugin_id(plugin_id)?;
        ensure!(!method.trim().is_empty(), "插件调用方法不能为空");

        let runtime = self.ensure_runtime(plugin_id)?;
        let mut runtime = runtime.lock().await;

        if let Some(status) = runtime.child.try_wait().context("无法检查插件进程状态")? {
            bail!("插件后端已退出，状态码: {status}");
        }

        let request_id = Uuid::new_v4().to_string();
        let request = PluginRpcRequest {
            id: &request_id,
            method,
            params: &params,
        };
        let request_line = serde_json::to_string(&request).context("无法序列化插件后端调用请求")?;

        runtime
            .stdin
            .write_all(request_line.as_bytes())
            .await
            .context("无法写入插件进程输入流")?;
        runtime
            .stdin
            .write_all(b"\n")
            .await
            .context("无法写入插件进程输入流")?;
        runtime
            .stdin
            .flush()
            .await
            .context("无法刷新插件进程输入流")?;

        let mut response_line = String::new();
        let bytes = runtime
            .stdout
            .read_line(&mut response_line)
            .await
            .context("无法读取插件进程响应")?;

        if bytes == 0 {
            self.invalidate_runtime(plugin_id)?;
            bail!("插件后端未返回响应，进程可能已经退出");
        }

        let response: PluginRpcResponse = serde_json::from_str(response_line.trim())
            .with_context(|| format!("插件后端响应格式错误: {}", response_line.trim()))?;

        ensure!(response.id == request_id, "插件后端响应 request_id 不匹配");

        if let Some(error) = response.error {
            bail!(error.message);
        }

        Ok(response.result.unwrap_or(JsonValue::Null))
    }

    pub async fn stop_all(&self) -> Result<()> {
        let runtimes = {
            let mut guard = self
                .runtimes
                .inner
                .lock()
                .map_err(|_| anyhow!("无法锁定插件运行时注册表"))?;
            guard
                .drain()
                .map(|(_, runtime)| runtime)
                .collect::<Vec<_>>()
        };

        for runtime in runtimes {
            let mut runtime = runtime.lock().await;
            let _ = runtime.child.kill().await;
        }

        Ok(())
    }

    fn load_installed_plugin(&self, plugin_dir: &Path) -> Result<InstalledPlugin> {
        let manifest = read_plugin_manifest(plugin_dir)?;
        self.validate_manifest(&manifest, plugin_dir)?;
        build_installed_plugin(
            &manifest,
            plugin_dir,
            &self.plugin_data_dir,
            &self.current_platform,
        )
    }

    fn validate_manifest(&self, manifest: &PluginManifest, plugin_dir: &Path) -> Result<()> {
        ensure!(manifest.schema_version == 1, "暂不支持该插件协议版本");
        validate_plugin_id(&manifest.id)?;
        ensure!(
            manifest.kind.trim() == "tool",
            "插件类型仅支持 tool，当前为 {}",
            manifest.kind
        );
        ensure!(
            manifest.workspace_mode.trim() == PLUGIN_WORKSPACE_MODE,
            "插件工作区模式仅支持 {PLUGIN_WORKSPACE_MODE}"
        );
        ensure!(
            manifest.host_api_version == HOST_API_VERSION,
            "宿主 API 版本不匹配"
        );
        ensure!(!manifest.name.trim().is_empty(), "插件名称不能为空");
        ensure!(!manifest.version.trim().is_empty(), "插件版本不能为空");
        ensure!(
            !manifest.frontend_entry.trim().is_empty(),
            "插件前端入口不能为空"
        );

        let frontend_path = plugin_dir.join(&manifest.frontend_entry);
        ensure!(
            frontend_path.exists(),
            "插件前端入口不存在: {}",
            frontend_path.display()
        );

        validate_backend_manifest(&manifest.backend)?;

        if manifest.backend.required {
            let Some(relative_path) = manifest
                .backend
                .entry_by_platform
                .get(&self.current_platform)
            else {
                bail!("插件不支持当前平台 {}", self.current_platform);
            };

            let backend_path = plugin_dir.join(relative_path);
            ensure!(
                backend_path.exists(),
                "插件后端入口不存在: {}",
                backend_path.display()
            );
        }

        if let Some(icon) = &manifest.icon {
            let icon_path = plugin_dir.join(icon);
            ensure!(
                icon_path.exists(),
                "插件图标不存在: {}",
                icon_path.display()
            );
        }

        Ok(())
    }

    fn ensure_runtime(&self, plugin_id: &str) -> Result<Arc<AsyncMutex<PluginRuntime>>> {
        if let Some(runtime) = self.lookup_runtime(plugin_id)? {
            return Ok(runtime);
        }

        let plugin_dir = self.plugins_dir.join(plugin_id);
        let manifest = read_plugin_manifest(&plugin_dir)?;
        self.validate_manifest(&manifest, &plugin_dir)?;
        let backend_path =
            resolve_backend_path(&plugin_dir, &manifest.backend, &self.current_platform)?;
        let plugin_data_dir = self.plugin_data_dir.join(plugin_id);
        fs::create_dir_all(&plugin_data_dir)
            .with_context(|| format!("无法创建插件数据目录: {}", plugin_data_dir.display()))?;

        let mut command = Command::new(&backend_path);
        command
            .current_dir(&plugin_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .env("ZSZC_PLUGIN_ID", plugin_id)
            .env("ZSZC_PLUGIN_INSTALL_DIR", &plugin_dir)
            .env("ZSZC_PLUGIN_DATA_DIR", &plugin_data_dir)
            .env("ZSZC_PLUGIN_PLATFORM", &self.current_platform)
            .env("ZSZC_PLUGIN_HOST_VERSION", HOST_VERSION)
            .arg("--stdio");

        let mut child = command
            .spawn()
            .with_context(|| format!("无法启动插件后端进程: {}", backend_path.display()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("插件后端缺少 stdin 管道"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("插件后端缺少 stdout 管道"))?;
        let runtime = Arc::new(AsyncMutex::new(PluginRuntime {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        }));

        let mut guard = self
            .runtimes
            .inner
            .lock()
            .map_err(|_| anyhow!("无法锁定插件运行时注册表"))?;
        Ok(guard
            .entry(plugin_id.to_string())
            .or_insert_with(|| runtime.clone())
            .clone())
    }

    fn lookup_runtime(&self, plugin_id: &str) -> Result<Option<Arc<AsyncMutex<PluginRuntime>>>> {
        let guard = self
            .runtimes
            .inner
            .lock()
            .map_err(|_| anyhow!("无法锁定插件运行时注册表"))?;
        Ok(guard.get(plugin_id).cloned())
    }

    fn invalidate_runtime(&self, plugin_id: &str) -> Result<()> {
        let mut guard = self
            .runtimes
            .inner
            .lock()
            .map_err(|_| anyhow!("无法锁定插件运行时注册表"))?;
        guard.remove(plugin_id);
        Ok(())
    }

    fn stop_runtime(&self, plugin_id: &str) -> Result<()> {
        let runtime = {
            let mut guard = self
                .runtimes
                .inner
                .lock()
                .map_err(|_| anyhow!("无法锁定插件运行时注册表"))?;
            guard.remove(plugin_id)
        };

        if let Some(runtime) = runtime
            && let Ok(mut runtime) = runtime.try_lock()
        {
            let _ = runtime.child.start_kill();
        }

        Ok(())
    }
}

fn validate_backend_manifest(backend: &PluginBackendManifest) -> Result<()> {
    ensure!(
        backend.startup.trim() == "on_demand",
        "插件后端启动模式仅支持 on_demand"
    );
    ensure!(
        !backend.required || !backend.entry_by_platform.is_empty(),
        "插件后端入口不能为空"
    );
    Ok(())
}

fn resolve_backend_path(
    plugin_dir: &Path,
    backend: &PluginBackendManifest,
    current_platform: &str,
) -> Result<PathBuf> {
    let relative_path = backend
        .entry_by_platform
        .get(current_platform)
        .ok_or_else(|| anyhow!("插件不支持当前平台 {current_platform}"))?;
    Ok(plugin_dir.join(relative_path))
}

fn build_installed_plugin(
    manifest: &PluginManifest,
    plugin_dir: &Path,
    plugin_data_dir_root: &Path,
    current_platform: &str,
) -> Result<InstalledPlugin> {
    let frontend_entry_path = plugin_dir.join(&manifest.frontend_entry);
    let icon_path = manifest.icon.as_ref().map(|value| plugin_dir.join(value));
    let supported_platforms = manifest
        .backend
        .entry_by_platform
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let current_platform_supported = !manifest.backend.required
        || manifest
            .backend
            .entry_by_platform
            .contains_key(current_platform);

    Ok(InstalledPlugin {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        kind: manifest.kind.clone(),
        description: manifest.description.clone(),
        install_dir: plugin_dir.display().to_string(),
        data_dir: plugin_data_dir_root
            .join(&manifest.id)
            .display()
            .to_string(),
        icon_path: icon_path.map(|path| path.display().to_string()),
        frontend_entry_path: frontend_entry_path.display().to_string(),
        workspace_mode: manifest.workspace_mode.clone(),
        current_platform: current_platform.to_string(),
        supported_platforms,
        current_platform_supported,
        backend_required: manifest.backend.required,
        permissions: manifest.permissions.clone(),
    })
}

fn read_plugin_manifest(plugin_dir: &Path) -> Result<PluginManifest> {
    let manifest_path = plugin_dir.join(PLUGIN_MANIFEST_FILE_NAME);
    let manifest_text = fs::read_to_string(&manifest_path)
        .with_context(|| format!("无法读取插件清单: {}", manifest_path.display()))?;
    serde_json::from_str::<PluginManifest>(&manifest_text)
        .with_context(|| format!("插件清单格式错误: {}", manifest_path.display()))
}

fn build_frontend_document(frontend_entry_path: &Path) -> Result<String> {
    let html = fs::read_to_string(frontend_entry_path)
        .with_context(|| format!("无法读取插件前端入口: {}", frontend_entry_path.display()))?;
    let Some(frontend_dir) = frontend_entry_path.parent() else {
        bail!("插件前端入口路径非法: {}", frontend_entry_path.display());
    };

    let html = inline_stylesheet_links(&html, frontend_dir)?;
    inline_module_script_sources(&html, frontend_dir)
}

fn inline_stylesheet_links(html: &str, frontend_dir: &Path) -> Result<String> {
    let pattern = Regex::new(r#"<link\b[^>]*>"#).expect("stylesheet regex should compile");

    replace_html_matches(&pattern, html, |captures| {
        let tag = captures
            .get(0)
            .map(|value| value.as_str())
            .ok_or_else(|| anyhow!("插件样式标签为空"))?;
        let attributes = extract_html_attributes(tag);
        let is_stylesheet = attributes
            .get("rel")
            .is_some_and(|value| value.eq_ignore_ascii_case("stylesheet"));
        if !is_stylesheet {
            return Ok(tag.to_string());
        }

        let href = attributes
            .get("href")
            .map(|value| value.as_str())
            .ok_or_else(|| anyhow!("插件样式链接缺少 href"))?;

        let Some(asset_path) = resolve_frontend_asset_path(frontend_dir, href) else {
            return Ok(tag.to_string());
        };

        let css = fs::read_to_string(&asset_path)
            .with_context(|| format!("无法读取插件样式文件: {}", asset_path.display()))?;
        Ok(format!(
            r#"<style data-plugin-inline-href="{}">{}</style>"#,
            href,
            escape_inline_style(&css)
        ))
    })
}

fn inline_module_script_sources(html: &str, frontend_dir: &Path) -> Result<String> {
    let pattern =
        Regex::new(r#"<script\b[^>]*>\s*</script>"#).expect("script regex should compile");

    replace_html_matches(&pattern, html, |captures| {
        let tag = captures
            .get(0)
            .map(|value| value.as_str())
            .ok_or_else(|| anyhow!("插件脚本标签为空"))?;
        let attributes = extract_html_attributes(tag);
        let is_module = attributes
            .get("type")
            .is_some_and(|value| value.eq_ignore_ascii_case("module"));
        if !is_module {
            return Ok(tag.to_string());
        }

        let src = attributes
            .get("src")
            .map(|value| value.as_str())
            .ok_or_else(|| anyhow!("插件脚本标签缺少 src"))?;

        let Some(asset_path) = resolve_frontend_asset_path(frontend_dir, src) else {
            return Ok(tag.to_string());
        };

        let script = fs::read_to_string(&asset_path)
            .with_context(|| format!("无法读取插件脚本文件: {}", asset_path.display()))?;
        Ok(format!(
            r#"<script type="module" data-plugin-inline-src="{}">{}</script>"#,
            src,
            escape_inline_script(&script)
        ))
    })
}

fn replace_html_matches<F>(pattern: &Regex, html: &str, mut replacer: F) -> Result<String>
where
    F: FnMut(&regex::Captures<'_>) -> Result<String>,
{
    let mut result = String::with_capacity(html.len());
    let mut last_end = 0;

    for captures in pattern.captures_iter(html) {
        let Some(matched) = captures.get(0) else {
            continue;
        };

        result.push_str(&html[last_end..matched.start()]);
        result.push_str(&replacer(&captures)?);
        last_end = matched.end();
    }

    result.push_str(&html[last_end..]);
    Ok(result)
}

fn extract_html_attributes(tag: &str) -> HashMap<String, String> {
    let pattern = Regex::new(r#"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*["']([^"']+)["']"#)
        .expect("attribute regex should compile");

    pattern
        .captures_iter(tag)
        .filter_map(|captures| {
            let name = captures.get(1)?.as_str().to_ascii_lowercase();
            let value = captures.get(2)?.as_str().to_string();
            Some((name, value))
        })
        .collect()
}

fn resolve_frontend_asset_path(frontend_dir: &Path, reference: &str) -> Option<PathBuf> {
    let clean_reference = reference
        .split(['?', '#'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    if clean_reference.starts_with("http://")
        || clean_reference.starts_with("https://")
        || clean_reference.starts_with("//")
        || clean_reference.starts_with("data:")
        || clean_reference.starts_with("blob:")
        || clean_reference.starts_with("asset:")
        || clean_reference.starts_with("tauri:")
    {
        return None;
    }

    Some(frontend_dir.join(clean_reference))
}

fn escape_inline_script(script: &str) -> String {
    script.replace("</script", r"<\/script")
}

fn escape_inline_style(style: &str) -> String {
    style.replace("</style", r"<\/style")
}

fn resolve_plugin_root(staging_root: &Path) -> Result<PathBuf> {
    let direct_manifest = staging_root.join(PLUGIN_MANIFEST_FILE_NAME);
    if direct_manifest.exists() {
        return Ok(staging_root.to_path_buf());
    }

    let mut candidate_dirs = Vec::new();
    for entry in fs::read_dir(staging_root).context("无法读取插件暂存目录")? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            candidate_dirs.push(entry.path());
        }
    }

    if candidate_dirs.len() == 1 {
        let candidate = &candidate_dirs[0];
        if candidate.join(PLUGIN_MANIFEST_FILE_NAME).exists() {
            return Ok(candidate.clone());
        }
    }

    bail!("插件包根目录缺少 plugin.json")
}

fn extract_plugin_package(package_path: &Path, destination: &Path) -> Result<()> {
    let file = fs::File::open(package_path)
        .with_context(|| format!("无法打开插件安装包: {}", package_path.display()))?;
    let mut archive = ZipArchive::new(file).context("插件安装包不是有效的 zip 文件")?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(relative_path) = entry.enclosed_name() else {
            bail!("插件安装包存在非法路径");
        };
        let output_path = destination.join(&relative_path);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output = fs::File::create(&output_path)
            .with_context(|| format!("无法创建插件文件: {}", output_path.display()))?;
        io::copy(&mut entry, &mut output)
            .with_context(|| format!("无法解压插件文件: {}", output_path.display()))?;
        mark_backend_file_executable_if_needed(&relative_path, &output_path)?;
    }

    Ok(())
}

fn validate_plugin_id(plugin_id: &str) -> Result<()> {
    ensure!(!plugin_id.trim().is_empty(), "插件 ID 不能为空");
    ensure!(
        plugin_id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '-' | '_')),
        "插件 ID 仅支持字母、数字、点号、横线和下划线"
    );
    Ok(())
}

fn current_platform() -> String {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-aarch64".to_string(),
        ("macos", "x86_64") => "darwin-x86_64".to_string(),
        ("windows", "x86_64") => "windows-x86_64".to_string(),
        (os, arch) => format!("{os}-{arch}"),
    }
}

pub fn empty_install_dialog_result() -> PluginInstallDialogResult {
    PluginInstallDialogResult {
        canceled: true,
        plugin: None,
    }
}

#[cfg(unix)]
fn mark_backend_file_executable_if_needed(relative_path: &Path, output_path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let components = relative_path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if components.first().is_some_and(|value| value == "backend")
        && output_path.extension().and_then(|value| value.to_str()) != Some("exe")
    {
        let mut permissions = fs::metadata(output_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(output_path, permissions)?;
    }

    Ok(())
}

#[cfg(not(unix))]
fn mark_backend_file_executable_if_needed(
    _relative_path: &Path,
    _output_path: &Path,
) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    #[test]
    fn install_list_and_uninstall_plugin_package() {
        let temp_root =
            std::env::temp_dir().join(format!("zszc-plugin-host-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_root).expect("create temp root");

        let package_path = temp_root.join("sample.zszc-plugin");
        create_sample_plugin_package(&package_path).expect("create sample package");

        let host = PluginHost::new(temp_root.join("app-data")).expect("create plugin host");
        let installed = host
            .install_from_package(&package_path)
            .expect("install sample package");

        assert_eq!(installed.id, "test.sample-tool");
        assert_eq!(installed.name, "样板工具");
        assert!(installed.current_platform_supported);

        let installed_plugins = host
            .list_installed_plugins()
            .expect("list installed plugins");
        assert_eq!(installed_plugins.len(), 1);

        let document = host
            .read_frontend_document("test.sample-tool")
            .expect("read frontend document");
        assert!(document.html.contains("sample"));
        assert!(document.html.contains("data-plugin-inline-href"));
        assert!(document.html.contains("data-plugin-inline-src"));

        host.uninstall("test.sample-tool")
            .expect("uninstall plugin");
        let installed_plugins = host.list_installed_plugins().expect("list after uninstall");
        assert!(installed_plugins.is_empty());

        let _ = fs::remove_dir_all(&temp_root);
    }

    fn create_sample_plugin_package(package_path: &Path) -> Result<()> {
        let file = File::create(package_path)?;
        let mut archive = ZipWriter::new(file);
        let file_options = SimpleFileOptions::default();

        archive.start_file("plugin.json", file_options)?;
        archive.write_all(
            r#"{
  "schema_version": 1,
  "id": "test.sample-tool",
  "name": "样板工具",
  "version": "1.0.0",
  "kind": "tool",
  "description": "用于验证插件安装流程",
  "icon": null,
  "frontend_entry": "frontend/index.html",
  "workspace_mode": "full_workspace",
  "backend": {
    "required": false,
    "startup": "on_demand",
    "entry_by_platform": {}
  },
  "permissions": ["full"],
  "host_api_version": 1,
  "min_host_version": "0.1.0"
}"#
            .as_bytes(),
        )?;

        archive.start_file("frontend/index.html", file_options)?;
        archive.write_all(
            br#"<!doctype html><html><head><link rel="stylesheet" href="./assets/app.css"><script type="module" src="./assets/app.js"></script></head><body><div id="root">sample</div></body></html>"#,
        )?;
        archive.start_file("frontend/assets/app.css", file_options)?;
        archive.write_all(br#"body{background:#fff}"#)?;
        archive.start_file("frontend/assets/app.js", file_options)?;
        archive.write_all(br#"document.body.dataset.loaded="yes";"#)?;
        archive.finish()?;
        Ok(())
    }
}
