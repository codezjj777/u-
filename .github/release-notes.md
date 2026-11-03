Windows x64 便携版，下载并完整解压后双击 `一键启动.cmd`，使用结束双击 `一键停止.cmd`。

### 下载

- **`U-Study-<版本>-windows-x64.zip`**：推荐，已包含 Node.js 与运行依赖，无需另装 Node.js。
- `u-study-workspace-<版本>.tgz`：源码运行包，需要 Node.js 20.19+。
- `SHA256SUMS.txt`：附件校验值。
- `windows-manifest.json`：文件清单及 Node.js 官方运行时来源。

### 使用

1. 需要 Windows 10 / 11 x64，以及 Microsoft Edge 或 Google Chrome。
2. 解压后启动，在专用窗口登录 U校园，回工作台同步课程。
3. 在答题设置中导入自己的题库，或配置自己的 AI 接口、模型和 Key。
4. 默认在最终提交前等待人工核对，完成情况以平台目录为准。
5. 可选听力识别需另装 Python 3.10–3.13，并运行 `u-study/准备听力识别.cmd` 下载组件与模型。

包含课程进度同步、任务结束后的进度刷新，以及已适配题型的辅助处理。详细支持范围、数据备份、更新与排错方法见仓库 README 和 `u-study/README.md`。

发布包不包含个人登录资料、课程记录、真实题库、API Key 或语音模型。当前已保存的 Key 为本机明文，个人数据目录 `u-study/.runtime/` 请勿分享。仓库为 Private 时，此 Release 和附件仍仅对有权限的账号可见。
