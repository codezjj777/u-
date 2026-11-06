## v1.4.31 · 2026-11-06

### 密钥与本地访问

- Windows 版通过当前用户的 DPAPI 加密 API Key。首次启动会迁移旧版明文凭据。同一台电脑、同一个 Windows 账号可以继续使用已保存的 Key。
- 本地后台每次启动生成新的访问令牌。除健康探测外，课程与任务状态、题库导出、实时事件、学习时长和安全退出等接口都需要有效令牌。
- 启动器自动授权工作台。刷新页面保留授权，后台重启后需从「一键启动.cmd」重新打开工作台。
- 媒体答案预览在调用 AI 前核对已保存 Key 对应的接口地址。

### 下载与升级

安全退出旧版，备份 `u-study/.runtime/`，再将 `U-Study-1.4.31-windows-x64.zip` 解压到新目录。需要保留配置、题库和进度时，将备份复制到新版的 `u-study/.runtime/`，然后双击「一键启动.cmd」。换电脑或 Windows 账号后，请重新输入 API Key。旧版备份中的 Key 仍可能是明文，请妥善保管。

完整日志见 [CHANGELOG.md](https://github.com/codezjj777/UCampus/blob/v1.4.31/u-study/CHANGELOG.md)。
