use crate::error::PluginError;
use crate::models::{ConnectionTestResult, PermissionCheckStatus, PermissionStatus};
use reqwest::blocking::{Client, RequestBuilder};
use serde::Deserialize;
use std::collections::{BTreeMap, VecDeque};
use std::time::Duration;

const ROOT_DEPARTMENT_ID: i64 = 1;
const USER_PAGE_SIZE: i64 = 100;

#[derive(Debug, Clone)]
pub struct DingtalkClient {
    http: Client,
    base_url: String,
    app_id: String,
    app_secret: String,
}

#[derive(Debug, Clone)]
pub struct DingtalkUser {
    pub user_id: String,
    pub user_name: String,
}

#[derive(Debug, Clone)]
pub struct QuerySnapshot {
    pub users: Vec<DingtalkUser>,
}

impl DingtalkClient {
    pub fn new(base_url: String, app_id: String, app_secret: String) -> Result<Self, PluginError> {
        let normalized_base_url = normalize_base_url(&base_url)?;
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| PluginError::Request(format!("创建钉钉 HTTP 客户端失败: {error}")))?;

        Ok(Self {
            http,
            base_url: normalized_base_url,
            app_id,
            app_secret,
        })
    }

    pub fn test_connection(&self, tested_at: String) -> Result<ConnectionTestResult, PluginError> {
        let access_token = self.get_access_token()?;
        let departments = self.list_sub_departments(&access_token, ROOT_DEPARTMENT_ID)?;
        let probe_department_id = departments
            .first()
            .map(|department| department.id)
            .unwrap_or(ROOT_DEPARTMENT_ID);
        self.list_department_users(&access_token, probe_department_id)?;

        let permissions = vec![
            PermissionStatus {
                key: "access_token".to_string(),
                label: "获取access_token接口权限".to_string(),
                status: PermissionCheckStatus::Enabled,
                detail: "access_token 获取成功".to_string(),
            },
            PermissionStatus {
                key: "user_list".to_string(),
                label: "通讯录用户列表读取权限".to_string(),
                status: PermissionCheckStatus::Enabled,
                detail: "用户列表接口调用成功".to_string(),
            },
            PermissionStatus {
                key: "department_list".to_string(),
                label: "部门信息读取权限".to_string(),
                status: PermissionCheckStatus::Enabled,
                detail: "部门列表接口调用成功".to_string(),
            },
        ];

        Ok(ConnectionTestResult {
            tested_at,
            success: true,
            message: "测试连接成功，基础权限验证通过。".to_string(),
            permissions,
        })
    }

    pub fn fetch_snapshot(&self) -> Result<QuerySnapshot, PluginError> {
        let access_token = self.get_access_token()?;
        let mut queue = VecDeque::from([ROOT_DEPARTMENT_ID]);
        let mut users = BTreeMap::<String, DingtalkUser>::new();

        while let Some(department_id) = queue.pop_front() {
            for department in self.list_sub_departments(&access_token, department_id)? {
                queue.push_back(department.id);
            }

            for user in self.list_department_users(&access_token, department_id)? {
                users.entry(user.user_id.clone()).or_insert(user);
            }
        }

        Ok(QuerySnapshot {
            users: users.into_values().collect(),
        })
    }

    fn get_access_token(&self) -> Result<String, PluginError> {
        if self.app_id.trim().is_empty() || self.app_secret.trim().is_empty() {
            return Err(PluginError::InvalidInput(
                "应用ID 和应用密钥不能为空".to_string(),
            ));
        }

        let response = self
            .http
            .get(format!("{}/gettoken", self.base_url))
            .query(&[
                ("appkey", self.app_id.as_str()),
                ("appsecret", self.app_secret.as_str()),
            ])
            .send()
            .map_err(map_request_error)?;

        let payload: AccessTokenResponse = decode_payload(response)?;
        if payload.access_token.trim().is_empty() {
            return Err(PluginError::Request(
                "钉钉返回的 access_token 为空".to_string(),
            ));
        }

        Ok(payload.access_token)
    }

    fn list_sub_departments(
        &self,
        access_token: &str,
        department_id: i64,
    ) -> Result<Vec<DingtalkDepartment>, PluginError> {
        let response = self
            .authorized_request("/department/list", access_token)
            .query(&[
                ("id", department_id.to_string()),
                ("fetch_child", "false".to_string()),
            ])
            .send()
            .map_err(map_request_error)?;
        let payload: DepartmentListResponse = decode_payload(response)?;

        Ok(payload.department.unwrap_or_default())
    }

    fn list_department_users(
        &self,
        access_token: &str,
        department_id: i64,
    ) -> Result<Vec<DingtalkUser>, PluginError> {
        let mut offset = 0_i64;
        let mut users = Vec::new();

        loop {
            let response = self
                .authorized_request("/user/listbypage", access_token)
                .query(&[
                    ("department_id", department_id.to_string()),
                    ("offset", offset.to_string()),
                    ("size", USER_PAGE_SIZE.to_string()),
                ])
                .send()
                .map_err(map_request_error)?;

            let payload: UserListResponse = decode_payload(response)?;
            for user in payload.userlist.unwrap_or_default() {
                if user.userid.trim().is_empty() || user.name.trim().is_empty() {
                    continue;
                }
                users.push(DingtalkUser {
                    user_id: user.userid,
                    user_name: user.name,
                });
            }

            if !payload.has_more.unwrap_or(false) {
                break;
            }
            offset += USER_PAGE_SIZE;
        }

        Ok(users)
    }
    fn authorized_request(&self, path: &str, access_token: &str) -> RequestBuilder {
        self.http
            .get(format!("{}{}", self.base_url, path))
            .query(&[("access_token", access_token)])
    }
}

fn normalize_base_url(base_url: &str) -> Result<String, PluginError> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err(PluginError::InvalidInput("接口域名不能为空".to_string()));
    }

    let normalized = trimmed.trim_end_matches('/').to_string();
    if !(normalized.starts_with("http://") || normalized.starts_with("https://")) {
        return Err(PluginError::InvalidInput(
            "接口域名必须以 http:// 或 https:// 开头".to_string(),
        ));
    }

    Ok(normalized)
}

fn decode_payload<T>(response: reqwest::blocking::Response) -> Result<T, PluginError>
where
    T: for<'de> Deserialize<'de> + DingTalkApiPayload,
{
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| PluginError::Request(format!("读取钉钉响应失败: {error}")))?;

    if !status.is_success() {
        return Err(PluginError::Request(format!(
            "钉钉接口响应异常，HTTP 状态码 {status}"
        )));
    }

    let payload: T = serde_json::from_str(&body)
        .map_err(|error| PluginError::Request(format!("解析钉钉响应失败: {error}")))?;
    payload.ensure_success()?;
    Ok(payload)
}

fn map_request_error(error: reqwest::Error) -> PluginError {
    PluginError::Request(format!("调用钉钉接口失败: {error}"))
}

trait DingTalkApiPayload {
    fn ensure_success(&self) -> Result<(), PluginError>;
}

#[derive(Debug, Deserialize)]
struct AccessTokenResponse {
    errcode: i64,
    errmsg: String,
    access_token: String,
    #[allow(dead_code)]
    expires_in: Option<i64>,
}

impl DingTalkApiPayload for AccessTokenResponse {
    fn ensure_success(&self) -> Result<(), PluginError> {
        if self.errcode == 0 {
            return Ok(());
        }
        Err(PluginError::Request(format!(
            "钉钉 access_token 获取失败: {}",
            self.errmsg
        )))
    }
}

#[derive(Debug, Deserialize)]
struct DepartmentListResponse {
    errcode: i64,
    errmsg: String,
    department: Option<Vec<DingtalkDepartment>>,
}

impl DingTalkApiPayload for DepartmentListResponse {
    fn ensure_success(&self) -> Result<(), PluginError> {
        if self.errcode == 0 {
            return Ok(());
        }
        Err(PluginError::Request(format!(
            "钉钉部门查询失败: {}",
            self.errmsg
        )))
    }
}

#[derive(Debug, Deserialize)]
struct UserListResponse {
    errcode: i64,
    errmsg: String,
    #[serde(default)]
    has_more: Option<bool>,
    userlist: Option<Vec<UserListItem>>,
}

impl DingTalkApiPayload for UserListResponse {
    fn ensure_success(&self) -> Result<(), PluginError> {
        if self.errcode == 0 {
            return Ok(());
        }
        Err(PluginError::Request(format!(
            "钉钉用户列表查询失败: {}",
            self.errmsg
        )))
    }
}

#[derive(Debug, Deserialize)]
struct DingtalkDepartment {
    id: i64,
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    parentid: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct UserListItem {
    userid: String,
    name: String,
}
