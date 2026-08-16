# DSH Tunnel QR Plugin

为 DeepSeek Harness Web 提供免费公网访问的一体化插件。安装后，插件自动下载并校验 `cloudflared`、启动 Cloudflare Quick Tunnel，并在 DSH 右下角提供二维码入口。Cloudflare account not required，不需要注册第三方账号或配置域名。

## 安装

需要 Node.js 22.19 或更高版本。使用 DSH 官方 profile 插件命令安装已审查的固定提交：

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add "github:13323232dong/dsh-tunnel-qr-plugin#e5ebbc1cd4f402f8bb98090981f95e98d201a3bf"
```

安装完成后重启 Web profile。首次启动会从 Cloudflare 官方 GitHub Release 下载对应平台的固定版本，校验 SHA-256 后缓存到 DSH 插件数据目录。下载和隧道启动完成后，点击右下角“二维码”按钮即可查看当前公网入口。

## 使用

- 手机扫描二维码后会自动完成一次性登录，不需要输入账号或密码。
- 二维码中的令牌只使用一次，并且仅在当前隧道地址和有效期内可用。
- 登录成功后使用 `HttpOnly; Secure; SameSite=Strict` Cookie 访问 HTTP 和 WebSocket。
- 可以在弹窗中刷新二维码。
- Quick Tunnel 地址可能在 DSH 或隧道重启后变化；旧地址、旧二维码和旧会话会失效。

## 支持平台

| 系统 | 架构 | 运行方式 |
| --- | --- | --- |
| macOS | x64、ARM64 | Cloudflare 官方原生程序 |
| Linux | x64、ARM64 | Cloudflare 官方原生程序 |
| Windows | x64 | Cloudflare 官方 AMD64 程序 |
| Windows ARM64 | ARM64 | 通过 Windows x64 emulation 运行官方 AMD64 程序，不是原生 ARM64 支持 |

插件只随 DSH 进程运行，不安装 LaunchAgent、Windows Service 或 systemd 服务，也不需要管理员权限。

## 状态与排查

- `正在启动`：正在校验或下载程序并建立隧道。
- `正在重连`：临时连接中断，插件正在有限次数重试。
- `启动失败`：可刷新二维码重新读取状态；若仍失败，检查 GitHub 下载网络和本机防火墙。
- `平台不支持`：当前系统或架构没有明确映射的 Cloudflare 发布物，插件不会尝试运行其他架构文件。

所有状态和二维码接口都使用 `Cache-Control: no-store`。公网入口只连接回环地址上的认证代理，不会直接暴露 DSH 本地端口。插件不会把二维码令牌、会话 Cookie 或临时公网地址写入仓库。

## 开发验证

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`verify` 运行 Host/Client 类型检查、无网络单元与集成测试、Host/Client 构建和 Git 产物漂移检查。
