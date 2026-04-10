const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const PORT = process.env.PORT || 3099;

// ── 支持的模型服务商 ──────────────────────────────────────
const PROVIDERS = {
  deepseek:    { hostname: 'api.deepseek.com',                    path: '/chat/completions',        defaultModel: 'deepseek-chat' },
  openai:      { hostname: 'api.openai.com',                      path: '/v1/chat/completions',     defaultModel: 'gpt-4o-mini' },
  claude:      { hostname: 'api.anthropic.com',                   path: '/v1/messages',             defaultModel: 'claude-3-5-haiku-20241022', isClaude: true },
  qwen:        { hostname: 'dashscope.aliyuncs.com',              path: '/compatible-mode/v1/chat/completions', defaultModel: 'qwen-plus' },
  glm:         { hostname: 'open.bigmodel.cn',                    path: '/api/paas/v4/chat/completions', defaultModel: 'glm-4-flash' },
  hunyuan:     { hostname: 'api.hunyuan.tencent.com',             path: '/v1/chat/completions',     defaultModel: 'hunyuan-turbos-latest' },
  moonshot:    { hostname: 'api.moonshot.cn',                     path: '/v1/chat/completions',     defaultModel: 'moonshot-v1-8k' },
  lingyiwanwu: { hostname: 'api.lingyiwanwu.com',                 path: '/v1/chat/completions',     defaultModel: 'yi-large' },
};

// 从环境变量读取配置
const AI_CONFIG = {
  provider: process.env.AI_PROVIDER || 'deepseek',
  apiKey:   process.env.AI_API_KEY   || process.env.DEEPSEEK_API_KEY || '',
  model:    process.env.AI_MODEL     || '',
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

// ── 统一 AI 调用 ──────────────────────────────────────────
function callAI(messages, maxTokens = 2000) {
  return new Promise((resolve, reject) => {
    const { provider, apiKey, model } = AI_CONFIG;
    const prov = PROVIDERS[provider] || PROVIDERS.deepseek;
    const actualModel = model || prov.defaultModel;

    let body, headers;

    if (prov.isClaude) {
      // ── Claude (Anthropic Messages API) ──
      // system message 需单独提取
      const systemMsg = messages.find(m => m.role === 'system');
      const userMsgs  = messages.filter(m => m.role !== 'system');
      const payload = {
        model: actualModel,
        max_tokens: maxTokens,
        messages: userMsgs,
      };
      if (systemMsg) payload.system = systemMsg.content;
      body = JSON.stringify(payload);
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      };
    } else {
      // ── OpenAI 兼容格式 ──
      body = JSON.stringify({ model: actualModel, messages, temperature: 0.1, max_tokens: maxTokens });
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      };
    }

    const req = https.request({
      hostname: prov.hostname,
      path: prov.path,
      method: 'POST',
      headers,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(
            typeof json.error === 'object' ? json.error.message : json.error
          ));
          // Claude 返回 content[0].text，其余返回 choices[0].message.content
          const text = prov.isClaude
            ? json.content?.[0]?.text
            : json.choices?.[0]?.message?.content;
          if (!text) return reject(new Error('AI 返回内容为空: ' + data.slice(0, 200)));
          resolve(text);
        } catch (e) {
          reject(new Error('AI 返回解析失败: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 提取代表性文本（前中后） ─────────────────────────────
function extractRepresentativeText(text, size = 8000) {
  if (text.length <= size) return text;
  const head = text.slice(0, Math.floor(size * 0.7));
  const tail = text.slice(text.length - Math.floor(size * 0.3));
  return head + '\n\n[...省略中间内容...]\n\n' + tail;
}

// ── 全文扫描：找包含锚字的独立短词 ──────────────────────
const TRASH_ENDINGS = new Set('了着过是在来去看说做让把被从问道叫喊拿给走坐站跑');

function scanIndependentWords(text, anchors, minCount = 2, maxLen = 6) {
  const freq = {};
  for (const ch of anchors) {
    const re = new RegExp('[\u4e00-\u9fa5]{0,3}' + ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\u4e00-\u9fa5]{0,3}', 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const w = m[0];
      if (w.length < 2 || w.length > maxLen) continue;
      const before = m.index > 0 ? text[m.index - 1] : ' ';
      const after = m.index + w.length < text.length ? text[m.index + w.length] : ' ';
      if (/[\u4e00-\u9fa5]/.test(before) || /[\u4e00-\u9fa5]/.test(after)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .filter(([, cnt]) => cnt >= minCount)
    .filter(([w]) => {
      if (TRASH_ENDINGS.has(w[w.length - 1])) return false;
      if (/[他她我你它们]/.test(w)) return false;
      return true;
    })
    .sort((a, b) => b[1] - a[1])
    .map(([w, cnt]) => ({ word: w, count: cnt }));
}

// 提取姓氏模板词组（代码兜底，确保不漏姓+职位/家族类词）
const SURNAME_SUFFIXES = [
  '总','总裁','总经理','副总','经理','副经理','主任','董事长','董','主席',
  '总监','助理','部长','院长','校长','队长','班长',
  '律师','大律师','医生','教授','老师','导师',
  '大人','将军','王爷','公子','少爷','少主','殿下','陛下',
  '爸','爸爸','父','父亲','老爸','爹',
  '妈','妈妈','母','母亲',
  '哥','哥哥','大哥','二哥','三哥',
  '姐','姐姐','大姐','二姐',
  '弟','弟弟','妹','妹妹',
  '叔','伯','舅','姑','爷爷','奶奶','嫂',
  '家','氏','家族','府',
  '集团','公司','企业','产业','投资','控股',
  '先生','小姐','女士','太太','夫人',
];
const SURNAME_PREFIXES = ['小', '老', '大', '姓'];

function generateSurnameGroups(surname, fullText) {
  if (!surname) return [];
  const candidates = new Set();
  for (const s of SURNAME_SUFFIXES) candidates.add(surname + s);
  for (const p of SURNAME_PREFIXES) {
    candidates.add(p + surname);
    candidates.add(p + surname + '的');
  }
  candidates.add('姓' + surname + '的');
  return [...candidates]
    .filter(w => fullText.includes(w))
    .sort((a, b) => b.length - a.length);
}

// ── 复姓提取 ─────────────────────────────────────────────
const COMPOUND_SURNAMES = ['欧阳','司马','上官','诸葛','东方','慕容','独孤','令狐','轩辕','公孙','百里','夏侯','皇甫','尉迟','长孙','宇文'];
function extractSurname(name) {
  if (!name) return '';
  for (const c of COMPOUND_SURNAMES) {
    if (name.startsWith(c)) return c;
  }
  return name[0] || '';
}

// ── 解析 AI 返回的 JSON ────────────────────────────────────
function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回格式异常');
  return JSON.parse(m[0]);
}

// ── 主分析流程（两步 AI 调用） ────────────────────────────
async function analyzeNovel(fullText, gongHint, shouHint, gongNewName, shouNewName) {

  // ── Step 1：获取角色信息（姓名、姓氏、名字各字、关联人物） ──
  const contextForStep1 = extractRepresentativeText(fullText, 10000);
  const hintPart = (gongHint || shouHint)
    ? `\n提示：${gongHint ? `攻可能叫"${gongHint}"` : ''}${shouHint ? `，受可能叫"${shouHint}"` : ''}`
    : '';

  const step1Prompt = `你是耽美/BL/言情小说分析助手。${hintPart}
分析以下小说，只返回JSON（所有字段只填实际内容，不填说明文字）：
{
  "summary": "400-600字完整剧情梗概",
  "novelType": "如：古言耽美、现代都市",
  "gong": {
    "mainName": "攻的全名（如：顾明远）",
    "surname": "攻的姓（如：顾）",
    "nameChars": ["名字每个字（如：明、远）"],
    "relatedNames": ["攻的同姓家人/配角全名，只填2-4字纯汉字人名，没有则填空数组[]"]
  },
  "shou": {
    "mainName": "受的全名（如：谢临）",
    "surname": "受的姓（如：谢）",
    "nameChars": ["名字每个字（如：临）"],
    "relatedNames": ["受的同姓家人/配角全名，只填2-4字纯汉字人名，没有则填空数组[]"]
  },
  "others": [
    { "name": "其他重要配角全名，只填2-4字纯汉字人名，最多2个" }
  ]
}

小说内容：
${contextForStep1}`;

  const step1Raw = await callAI([{ role: 'user', content: step1Prompt }], 2000);
  const step1Data = parseJSON(step1Raw);

  const { summary, novelType, gong: gongInfo, shou: shouInfo, others = [] } = step1Data;

  // ── Step 2：扫描全文 + AI 过滤称呼 ─────────────────────
  // 过滤 relatedNames：只保留2-6个纯汉字的人名（防止 AI 把说明文字写进去）
  const cleanedGongRelatedNames = (gongInfo.relatedNames || []).filter(n =>
    typeof n === 'string' && n.length >= 2 && n.length <= 6 && /^[\u4e00-\u9fa5]+$/.test(n)
  );
  const cleanedShouRelatedNames = (shouInfo.relatedNames || []).filter(n =>
    typeof n === 'string' && n.length >= 2 && n.length <= 6 && /^[\u4e00-\u9fa5]+$/.test(n)
  );
  const cleanedOthers = others.filter(o =>
    o.name && typeof o.name === 'string' && o.name.length >= 2 && o.name.length <= 6 && /^[\u4e00-\u9fa5]+$/.test(o.name)
  );

  // 构建攻/受/关联人物的锚字集合
  const gongRelatedAllChars = [
    ...cleanedGongRelatedNames.flatMap(n => [...n]),
    ...cleanedOthers.map(o => o.name || '').flatMap(n => [...n]),
  ];
  const gongAnchors = [...new Set([
    gongInfo.surname,
    ...(gongInfo.nameChars || []),
    ...gongRelatedAllChars,
  ])].filter(ch => /^[\u4e00-\u9fa5]$/.test(ch));

  const shouRelatedAllChars = cleanedShouRelatedNames.flatMap(n => [...n]);
  const shouAnchors = [...new Set([
    shouInfo.surname,
    ...(shouInfo.nameChars || []),
    ...shouRelatedAllChars,
  ])].filter(ch => /^[\u4e00-\u9fa5]$/.test(ch));

  console.log('攻锚字:', gongAnchors, '受锚字:', shouAnchors);

  // 扫描候选词
  const gongCandidates = scanIndependentWords(fullText, gongAnchors, 2, 6).slice(0, 60);
  const shouCandidates = scanIndependentWords(fullText, shouAnchors, 2, 6).slice(0, 80);

  // 构建姓氏词组（代码兜底）
  const gongSurnameGroups = generateSurnameGroups(gongInfo.surname, fullText);
  const shouSurnameGroups = generateSurnameGroups(shouInfo.surname, fullText);
  const gongRelatedSurnameGroups = {};
  for (const rn of cleanedGongRelatedNames) {
    const sn = extractSurname(rn);
    if (sn && sn !== gongInfo.surname) {
      gongRelatedSurnameGroups[rn] = generateSurnameGroups(sn, fullText);
    }
  }
  const shouRelatedSurnameGroups = {};
  for (const rn of (shouInfo.relatedNames || [])) {
    const sn = extractSurname(rn);
    if (sn && sn !== shouInfo.surname) {
      shouRelatedSurnameGroups[rn] = generateSurnameGroups(sn, fullText);
    }
  }

  console.log(`攻候选词 ${gongCandidates.length} 个，受候选词 ${shouCandidates.length} 个`);
  console.log('攻姓氏词组:', gongSurnameGroups);
  console.log('受姓氏词组:', shouSurnameGroups);

  // ── Step 2 Prompt：AI 从候选词中过滤出真正的称呼 ─────────
  const gongNew = gongNewName || '';
  const shouNew = shouNewName || '';

  const newNameRule = (gongNew || shouNew) ? `
新名字映射：攻改为"${gongNew || '未指定'}"，受改为"${shouNew || '未指定'}"
对每个 original，在 suggested 字段填写对应新称呼（只填称呼字符串本身，严禁括号说明）：
- 全名→新全名；单字名→新名对应字；叠字→新名某字的叠字；小X/阿X→保留前缀换核心字；尊称职位→与original相同` : '';

  const step2Prompt = `小说角色：
- 攻：${gongInfo.mainName}（姓${gongInfo.surname}）
- 受：${shouInfo.mainName}（姓${shouInfo.surname}）
- 攻的关联人物：${cleanedGongRelatedNames.join('、') || '无'}
- 受的关联人物：${cleanedShouRelatedNames.join('、') || '无'}
- 其他配角：${others.map(o => o.name).join('、') || '无'}
${newNameRule}

以下是从全文扫描的候选词（独立出现的、包含角色姓/名字的短词）。
请判断哪些是真正的「称呼」（叫人的名字/昵称/头衔），哪些是「行文片段」（动作描述的一部分），只保留称呼。

攻及关联人物的候选：${gongCandidates.map(x => x.word).join('、')}
受及关联人物的候选：${shouCandidates.map(x => x.word).join('、')}

只返回JSON，格式如下：
{
  "gong": {
    "variants": [{ "original": "称呼", "suggested": "新称呼" }],
    "relatedVariants": [
      { "name": "攻的关联人物全名", "variants": [{ "original": "称呼", "suggested": "新称呼或相同" }] }
    ]
  },
  "shou": {
    "variants": [{ "original": "称呼", "suggested": "新称呼" }],
    "relatedVariants": [
      { "name": "受的关联人物全名", "variants": [{ "original": "称呼", "suggested": "新称呼或相同" }] }
    ]
  },
  "others": [
    { "name": "配角全名", "variants": [{ "original": "称呼", "suggested": "相同" }] }
  ]
}`;

  const step2Raw = await callAI([{ role: 'user', content: step2Prompt }], 2000);
  const step2Data = parseJSON(step2Raw);

  // ── 组装最终结果 ──────────────────────────────────────
  const gongNewSurname = gongNew ? extractSurname(gongNew) : '';
  const shouNewSurname = shouNew ? extractSurname(shouNew) : '';

  // 构建姓氏词组替换项，支持三种模式：
  //   A. 词组以旧姓开头 → 替换开头（梁家 → 陆家）
  //   B. 词组以旧姓结尾 → 替换结尾（姓梁 → 姓陆）
  //   C. 旧姓在词组中间 → 替换中间（姓梁的 → 姓陆的）
  const buildSurnameGroupItems = (groups, oldSurname, newSurname) => {
    if (!oldSurname) return groups.map(w => ({ original: w, suggested: w }));
    const escaped = oldSurname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return groups.map(w => {
      if (!newSurname) return { original: w, suggested: w };
      const suggested = w.replace(new RegExp(escaped, 'g'), newSurname);
      return { original: w, suggested };
    });
  };

  // 判断关联人物姓氏是否跟随攻或受
  const getGongRelatedNewSurname = (relatedName) => {
    const relSurname = extractSurname(relatedName);
    if (relSurname && relSurname === gongInfo.surname) return gongNewSurname;
    return '';
  };
  const getShouRelatedNewSurname = (relatedName) => {
    const relSurname = extractSurname(relatedName);
    if (relSurname && relSurname === shouInfo.surname) return shouNewSurname;
    if (relSurname && relSurname === gongInfo.surname) return gongNewSurname;
    return '';
  };

  // 确保 variants 列表里全名那条一定存在且有正确 suggested
  const ensureMainName = (variants, mainName, newName) => {
    const existing = variants.find(v => v.original === mainName);
    if (existing) {
      if (!existing.suggested && newName) existing.suggested = newName;
      return variants;
    }
    return [{ original: mainName, suggested: newName || mainName }, ...variants];
  };

  const gongVariants = ensureMainName(step2Data.gong?.variants || [], gongInfo.mainName, gongNew);
  const shouVariants = ensureMainName(step2Data.shou?.variants || [], shouInfo.mainName, shouNew);

  return {
    summary,
    novelType,
    gong: {
      mainName: gongInfo.mainName,
      variants: gongVariants,
      surnameGroups: buildSurnameGroupItems(gongSurnameGroups, gongInfo.surname, gongNewSurname),
    },
    shou: {
      mainName: shouInfo.mainName,
      variants: shouVariants,
      surnameGroups: buildSurnameGroupItems(shouSurnameGroups, shouInfo.surname, shouNewSurname),
      relatedVariants: step2Data.shou?.relatedVariants || [],
    },
    others: [
      ...(step2Data.others || []),
      // 攻的关联人物
      ...(step2Data.gong?.relatedVariants || []).map(rv => {
        const relNewSurname = getGongRelatedNewSurname(rv.name);
        const relSurname = extractSurname(rv.name);
        const relGroups = gongRelatedSurnameGroups[rv.name] || generateSurnameGroups(relSurname, fullText);
        return {
          name: rv.name,
          variants: rv.variants || [],
          surnameGroups: buildSurnameGroupItems(relGroups, relSurname, relNewSurname),
        };
      }),
      // 受的关联人物
      ...(step2Data.shou?.relatedVariants || []).map(rv => {
        const relNewSurname = getShouRelatedNewSurname(rv.name);
        const relSurname = extractSurname(rv.name);
        const relGroups = shouRelatedSurnameGroups[rv.name] || generateSurnameGroups(relSurname, fullText);
        return {
          name: rv.name,
          variants: rv.variants || [],
          surnameGroups: buildSurnameGroupItems(relGroups, relSurname, relNewSurname),
        };
      }),
    ],
  };
}

// ── HTTP 服务器 ───────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/api/analyze' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (!AI_CONFIG.apiKey) throw new Error('未配置 API Key');
        const { text, gongHint, shouHint, gongNewName, shouNewName } = JSON.parse(body);
        if (!text) throw new Error('请提供文本内容');
        console.log(`开始分析，原文 ${(text.length / 10000).toFixed(1)} 万字`);

        const data = await analyzeNovel(text, gongHint, shouHint, gongNewName, shouNewName);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data }));
      } catch (err) {
        console.error('分析错误:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  let filePath = req.url === '/' ? '/public/index.html' : `/public${req.url}`;
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, fileData) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'text/plain' });
    res.end(fileData);
  });
});

server.listen(PORT, () => console.log(`✅ 服务已启动：http://localhost:${PORT}`));
