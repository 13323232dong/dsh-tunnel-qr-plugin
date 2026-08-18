# DSH Tunnel QR Plugin

一个用于 DeepSeek Harness Web 的二维码访问插件。安装后，会在页面右下角显示“二维码”按钮，方便重新打开公网隧道的访问二维码。

## 功能

- 二维码按钮固定在页面右下角，并针对移动端屏幕做了安全间距适配；
- 提供带关闭按钮的二维码弹窗，支持点击遮罩关闭和按 `Escape` 关闭；
- 显示 Basic Auth 用户名，密码默认隐藏，并支持显示/隐藏切换；
- 提供插件自有的 `/dsh-public-qr.png` 图片接口，支持 `GET` 和 `HEAD` 请求；
- 通过 DSH bundle patch 同时加载 Host 端和客户端功能。

二维码图片是针对已配置公网隧道生成的部署二维码。公网隧道地址发生变化后，请重新生成并替换 `assets/dsh-public-qr.png`。

## 安装

在 DSH 工作区或 profile 中，使用标准插件命令安装：

```sh
dsh plugin --profile web add https://github.com/13323232dong/dsh-tunnel-qr-plugin.git
```

安装完成后重启 Web profile。插件的 `dsh.bundle` patch 会挂载 Host 端，`dsh.client` 声明会加载浏览器端功能。

启动 DSH 前，在进程环境变量中设置访问凭证：

```sh
export DSH_TUNNEL_AUTH_USERNAME='your-username'
export DSH_TUNNEL_AUTH_PASSWORD='your-password'
```

生产环境建议使用操作系统钥匙串或密钥管理器提供密码。请勿把真实凭证提交到仓库。凭证接口仅提供读取能力，并设置了 `no-store`/`no-cache` 缓存策略。

## 开发

本仓库同时包含源代码和构建后的客户端产物。在 DSH 上游工作区中运行：

```sh
pnpm exec tsc -b tsconfig.json
pnpm run bundle
```

插件依赖 Host profile 提供的 DSH Host Webserver 和客户端运行时包。
