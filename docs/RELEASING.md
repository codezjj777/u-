# 版本发布与仓库可见性

仓库：[codezjj777/UCampus](https://github.com/codezjj777/UCampus)。仓库可见性以 GitHub 设置为准。自动发布不会修改 Public / Private 设置；私有仓库的 Release 仅对有权限的账号可见。

## 构建发布包

在 Windows 上安装 Node.js 20.19+，从仓库根目录执行：

```powershell
cd u-study
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run release
npm.cmd run release:windows
```

`release:windows` 从 Node.js 官方站点下载固定版本 Windows x64 运行时，使用官方 `SHASUMS256.txt` 校验后才解压；生产依赖使用锁文件安装。它仅复制 `release-files.mjs` 允许名单、根目录说明和启动入口，以及重新安装的生产依赖。不复制本机 `.runtime/`、已有依赖、日志或账号资料。

输出位于 `u-study/.cache/releases/`：

- `U-Study-<版本>-windows-x64.zip`：便携版，包含 Node.js、生产依赖和一键启动入口。
- `u-study-workspace-<版本>.tgz`：源码运行包，需要自行安装 Node.js 和依赖。
- `SHA256SUMS.txt`：以上附件的 SHA-256。
- `windows-manifest.json`：便携版文件清单和运行时校验信息。

便携包不含 Edge / Chrome、Python、语音模型或个人配置。构建暂存目录保留在忽略的 `.cache/releases/` 中。`USTUDY_NODE_VERSION` 可指定其他 Node.js 版本；更改后需重新验证兼容性。

## 创建 Release

仓库已配置 `.github/workflows/release.yml`：`main` 收到 `u-study/package.json`、锁文件或发布工作流的变更时，自动运行测试、构建便携包并创建与版本号对应的 Release。也可在 Actions 页面手动运行。已有同版本 Release 时会停止，避免覆盖；发布下一版前先更新版本号。工作流仅在仓库当前可见性范围内发布，不修改 Private / Public 设置。

需要手动发布时：

1. 保持 `package.json`、`package-lock.json` 与 `runtime-check.mjs` 的版本一致，完成上述验证和打包。
2. 提交源码到 `main`，打开仓库 **Releases → Draft a new release**。
3. 创建 `v<版本>` 标签，Target 选择包含本次代码的 `main`。
4. 标题填写 `U Study v<版本>`，说明变更、运行环境和使用方法。
5. 上传 Windows ZIP、TGZ、`SHA256SUMS.txt` 和 `windows-manifest.json`。
6. 检查后点击 **Publish release**。仓库保持 Private 时仍然是私有发布。

官方参考：[管理仓库中的发布](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

## 下载后验证

从 Release 下载 ZIP，计算摘要并与同一 Release 的 `SHA256SUMS.txt` 对比：

```powershell
Get-FileHash .\U-Study-1.4.30-windows-x64.zip -Algorithm SHA256
```

解压到新目录，在没有个人 `.runtime/` 的状态下检查工作台启动、停止和错误日志入口。不要将测试登录后的目录重新打包上传。

## 以后改为公开

公开前确认所有提交历史和发布附件均未包含个人资料、真实 Key、Cookie 或浏览器配置。源码排除规则见根目录 `.gitignore`，便携包另有允许名单。

准备好后，仓库所有者在 **Settings → General → Danger Zone → Change repository visibility → Make public** 按页面提示确认。此操作会让源码、历史、README 和发布附件对所有人可见。沿用原仓库和发布链接，无需重新上传。

官方说明：[设置仓库可见性](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)。
