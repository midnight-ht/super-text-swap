# SuperTextSwap 文本替换助手

**[English](README.md)** | **中文文档**

一个 Chrome 浏览器插件，根据自定义规则自动替换网页中的指定文本。面向内容创作者、运营人员和测试人员。

![zh poster](./public/zh%20-%20poster.png)

---

## 功能特性

| 功能       | 说明                                                        |
| ---------- | ----------------------------------------------------------- |
| 自定义规则 | 一键添加原文本与替换文本                                    |
| 立即生效   | 添加规则后无需刷新页面即可看到效果                          |
| 动态页面   | 通过 MutationObserver 支持 React / Vue / 无限滚动等动态内容 |
| URL 范围   | 规则可限定为所有页面、当前域名或自定义匹配模式              |
| DOM 范围   | 限定替换仅在指定 CSS 选择器元素内生效，支持可视化拾取       |
| 输入框     | 可选开启对 `input` / `textarea` 内容的替换                  |
| 富文本     | 可选开启对 `contenteditable` 编辑器内容的替换               |
| 中英文切换 | 弹窗界面支持简体中文与英文切换                              |
| 规则持久化 | 规则通过 `chrome.storage.sync` 保存，重启浏览器后仍保留     |

---

## 安装方法

### 方式一：CRX 文件（推荐）

1. 从 [Releases](../../releases) 下载 `text-swap-vX.X.X.crx`。
2. 打开 `chrome://extensions/`，开启右上角**开发者模式**。
3. 将 `.crx` 文件直接拖入页面，在弹出的确认框中点击**添加扩展程序**。

> Chrome 可能提示该扩展非来自应用商店，点击**添加扩展程序**继续即可。

### 方式二：ZIP 文件（加载未压缩）

1. 从 [Releases](../../releases) 下载 `text-swap-vX.X.X.zip`。
2. 将 ZIP 解压到任意本地文件夹。
3. 打开 `chrome://extensions/`，开启**开发者模式**。
4. 点击**加载已解压的扩展程序**，选择解压后的文件夹。

> 此方式无需签名密钥，适合测试环境或企业内部部署。

### 从源码安装

```bash
git clone https://github.com/YOUR_USERNAME/text-swap.git
cd text-swap
npm install
npm run build        # 生成 dist/ 以及 text-swap-vX.X.X.zip/.crx
```

在 Chrome → 扩展程序 → **加载已解压的扩展程序** 中选择 `dist/` 目录。

---

## 使用方法

1. 点击工具栏中的 **SuperTextSwap** 图标打开弹窗。
2. 在**原文本**和**替换为**输入框中填写规则。
3. 展开**限定范围 & 替换目标**，按需配置 URL 或 DOM 元素限定（可选）。
4. 点击**添加规则**——当前页面立即生效。
5. 随时点击 **⟳ 立即应用**，将所有规则重新应用到当前标签页。

### 元素拾取

点击 **⊕ 拾取** → 弹窗关闭，页面进入拾取模式（蓝色边框高亮跟随鼠标）。点击目标元素后，重新打开弹窗，CSS 选择器已自动填入。

---

## 项目结构

```
text-swap/
├── manifest.json            Chrome Manifest V3 配置
├── _locales/
│   ├── en/messages.json     英文字符串
│   └── zh_CN/messages.json  中文字符串
├── src/
│   ├── popup/               插件弹窗（HTML + JS）
│   ├── content/             注入页面的内容脚本
│   └── background/          Service Worker
├── icons/                   插件图标（16 / 48 / 128 px）
├── build.js                 构建与打包脚本
└── .github/workflows/       GitHub Actions 发布流水线
```

---

## 构建与打包

```bash
npm install          # 仅首次需要
npm run build
```

| 产物                   | 用途                                                    |
| ---------------------- | ------------------------------------------------------- |
| `dist/`                | 混淆后的源码——可在 Chrome 中加载未压缩扩展进行测试      |
| `text-swap-vX.X.X.zip` | 上传到 Chrome Web Store                                 |
| `text-swap-vX.X.X.crx` | 签名包，用于直接分发                                    |
| `key.pem`              | RSA 签名私钥——**务必备份**；丢失后重新生成会改变扩展 ID |

> `.js` 文件使用 `javascript-obfuscator` 混淆，`.json` 文件压缩去空格，其余文件直接复制。

---

## 版本发布（GitHub Actions）

推送版本标签后，发布流水线自动触发。

### 一次性配置

将 `key.pem` 保存为仓库 Secret，确保 CI 每次以相同密钥签名 CRX：

1. 进入仓库 **Settings → Secrets and variables → Actions → New repository secret**。
2. 名称：`EXTENSION_KEY_PEM`
3. 值：粘贴本地 `key.pem` 的完整内容。

### 发布新版本

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions 将自动完成构建、签名，并将 `.zip` 和 `.crx` 作为附件发布到新的 GitHub Release。

---

## 版本规划

| 版本     | 目标                               |
| -------- | ---------------------------------- |
| **v0.1** | 网页 DOM 文本替换 MVP ← _当前_     |
| v0.2     | 规则开关、域名限制、正则、导入导出 |
| v0.3     | 平台规则包、AI 感表达替换          |
| v0.4     | 图片 OCR 识别与覆盖层预览          |
| v0.5     | Canvas 图片重绘与导出              |

---

## 开源许可

[MIT License — Non-Commercial](LICENSE)

个人及非商业用途免费使用。商业使用需获得书面授权。  
联系方式：<ht@zyweb.vip>

![zh appreciate](./public/zh%20-%20appreciate.png)
