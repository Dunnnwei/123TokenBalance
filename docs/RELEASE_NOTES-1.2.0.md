# 123 Token Balance 1.2.0

发布日期：2026-10-19。Windows x64 完整便携版。

本版重点处理跨电脑双击无反馈的问题：新增无需外部运行库的原生启动环境检测窗口，缺文件、权限、跨机浏览器状态与启动超时均有诊断；默认软件渲染，并保留启动日志。

- 每次启动显示环境检测；程序内可查看检查详情、需求及官方链接。
- 新增 GitHub 新版本检测、校验下载、自动更新、旧版备份及启动失败回滚。
- 换电脑无法解密的配置保留原文件，可在界面归档后导入口令加密备份。
- 修复更新准备失败后的重试，并核对原有功能、旧版数据兼容、IPC 和更新安全边界。
- 发布包无需 Node、Python、.NET、WebView2 或 VC Redistributable；不要只复制 EXE。

## 下载与启动

下载 `123TokenBalance-1.2.0-win-x64.zip`，完整解压后运行文件夹中的 **123TokenBalance.exe**。`123TokenBalance.App.exe` 是内部主体。SHA256SUMS-1.2.0.txt 提供 ZIP 和启动器哈希；程序目录内部清单覆盖全部文件。

1.0.0 / 1.1.0 需先手动下载此版本。保留旧版，同机同 Windows 用户复制完整 `data` 到新目录；换机先在旧机导出口令备份，再在新机导入。不要公开自己的 `data`。

## 验证范围

测试和代码复核记录见包内 `docs/QA_REPORT.md` 与 `docs/CODE_REVIEW-1.2.0.md`。另一台用户电脑未进行物理验收，原始故障具体原因尚未确认。EXE 未配置发行者代码签名；本机 Defender 结果不代表所有杀软或 SmartScreen 都不会提示。无需关闭系统防护。

仓库：https://github.com/Dunnnwei/123TokenBalance

最新版本：https://github.com/Dunnnwei/123TokenBalance/releases/latest
