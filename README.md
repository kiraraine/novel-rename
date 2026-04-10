# 换头工作室 · 小说角色名替换

> 上传TXT，AI 自动识别角色的全部昵称变体，根据你指定的新名字推导对应称呼，一键生成替换版本。

![截图占位](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## 功能特性

- **AI 深度分析**：自动识别攻、受及配角的全名、昵称、叠字、前缀称呼（小X / 阿X）、姓氏词组（谢家 / 谢总 / 谢大哥）等所有变体
- **新名字智能推导**：填入新名字后，AI 自动将旧称呼映射为对应的新称呼
- **人工复核**：替换前可逐条确认 / 修改 / 跳过每一项映射
- **残留检测**：替换完成后自动扫描可能遗漏的原名变体并提示
- **多模型支持**：自由选择 AI 服务商，配置持久化保存，无需每次填写
- **完全本地运行**：无服务器，无数据上传，文件处理全在本机完成
- **支持 GBK / UTF-8**：自动检测编码，兼容大多数小说文件

---

## 支持的 AI 服务商

在页面右上角「API Key 设置」中选择服务商并填入对应 Key，保存后立即生效。

| 服务商 | 默认模型 | 获取 Key |
|--------|---------|---------|
| DeepSeek | `deepseek-chat` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| OpenAI | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic Claude | `claude-3-5-haiku-20241022` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| 阿里通义千问 | `qwen-plus` | [bailian.console.aliyun.com](https://bailian.console.aliyun.com/?apiKey=1) |
| 智谱 ChatGLM | `glm-4-flash` | [bigmodel.cn](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) |
| 腾讯混元 | `hunyuan-turbos-latest` | [console.cloud.tencent.com](https://console.cloud.tencent.com/hunyuan/api-key) |
| Moonshot / Kimi | `moonshot-v1-8k` | [platform.moonshot.cn](https://platform.moonshot.cn/console/api-keys) |
| 零一万物 | `yi-large` | [platform.lingyiwanwu.com](https://platform.lingyiwanwu.com/apikeys) |

> 模型名称可手动填写覆盖默认值，支持该服务商旗下任意模型。

---

## 本地运行

### 环境要求

- Node.js 18+

### 安装与启动

```bash
git clone https://github.com/yourname/novel-rename.git
cd novel-rename
npm install
node server.js
```

浏览器访问 [http://localhost:3099](http://localhost:3099)

### 配置 API Key

**方式一：页面内设置（推荐新手）**

在 `.env` 文件中开启设置入口：

```env
SHOW_SETTINGS=true
```

重启服务后，页面右上角会出现「API Key 设置」按钮，选择服务商、填写 Key 后保存即可。Key 会自动写入 `.env` 文件，重启后自动恢复。

**方式二：直接编辑 `.env` 文件**

```env
AI_PROVIDER=deepseek
AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
AI_MODEL=
```

`AI_MODEL` 留空则使用该服务商的默认模型，也可手动指定（如 `deepseek-reasoner`、`gpt-4o` 等）。

---

## 使用流程

1. **上传文件**：拖拽或点击选择 `.txt` 小说文件
2. **填写角色**（可选）：填入攻 / 受的原名（帮助 AI 更准确识别）和想改成的新名字
3. **AI 分析**：点击「开始 AI 分析」，等待 10–30 秒
4. **确认方案**：查看 AI 识别的所有称呼，蓝色为自动推导的建议新称呼，可直接修改或跳过
5. **生成下载**：点击「生成替换文件」，检查残留提示，下载新文件

---

## 技术栈

- **前端**：纯 HTML / CSS / JavaScript，无框架依赖
- **后端**：Node.js 原生 `http` 模块，无需 Express
- **AI**：标准 OpenAI Chat Completions 格式（Claude 单独适配 Anthropic Messages API）
- **持久化**：本地 `.env` 文件读写

---

## 项目结构

```
novel-rename/
├── server.js          # 后端服务，API 路由 + AI 调用逻辑
├── public/
│   └── index.html     # 前端页面（单文件）
├── .env               # API Key 配置（运行后自动生成，勿提交）
├── package.json
└── README.md
```

---

## 注意事项

- `.env` 文件包含你的 API Key，**请勿提交到公开仓库**（已在 `.gitignore` 中排除）
- 小说文件仅在本地处理，不会上传到任何服务器
- AI 分析会消耗约 2000–4000 tokens，请注意各服务商的用量和费用
