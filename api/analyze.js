const https = require('https');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

function callDeepSeek(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    });
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          resolve(json.choices[0].message.content);
        } catch (e) {
          reject(new Error('DeepSeek 返回解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractRepresentativeText(text) {
  if (text.length <= 40000) return text;
  const head = text.slice(0, 30000);
  const mid = text.slice(Math.floor(text.length / 2) - 5000, Math.floor(text.length / 2) + 5000);
  const tail = text.slice(text.length - 10000);
  return head + '\n\n[...中间省略...]\n\n' + mid + '\n\n[...省略至结尾...]\n\n' + tail;
}

function cleanSuggested(val) {
  if (!val || typeof val !== 'string') return '';
  let v = val.replace(/[（(][^）)]{0,40}[）)]/g, '').trim();
  if (!v || /保持|不变|通用|说明|建议|用户|可自行|同上|同原|原名|参考/.test(v)) return '';
  if (v.length > 10) return '';
  return v;
}

const GENERIC_BLACKLIST = new Set([
  '你','他','她','它','宝贝','亲爱的','老公','老婆','亲','哥','弟','姐','妹',
  '爸','妈','爷','奶','叔','伯','舅','姑','爸爸','妈妈','哥哥','弟弟',
  '姐姐','妹妹','父亲','母亲','男人','女人','那人','那个人',
]);

function cleanVariants(variants) {
  if (!Array.isArray(variants)) return [];
  return variants
    .map(v => {
      if (typeof v === 'string') return { original: v.trim(), suggested: '' };
      return { original: (v.original || '').trim(), suggested: cleanSuggested(v.suggested) };
    })
    .filter(v => v.original && v.original.length >= 1 && v.original.length <= 12 && !GENERIC_BLACKLIST.has(v.original));
}

function cleanSurnameGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map(g => typeof g === 'string' ? { original: g, suggested: '' } : g)
    .map(g => ({ original: (g.original || '').trim(), suggested: cleanSuggested(g.suggested) || (g.original || '').trim() }))
    .filter(g => g.original && g.original.length >= 2 && g.original.length <= 15);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, gongHint, shouHint, gongNewName, shouNewName } = req.body;
    if (!text) return res.status(400).json({ error: '请提供文本内容' });

    const sampleText = extractRepresentativeText(text);
    const gongNew = gongNewName || '';
    const shouNew = shouNewName || '';

    const hintPart = (gongHint || shouHint)
      ? `\n【角色提示】${gongHint ? `攻可能叫"${gongHint}"` : ''}${shouHint ? `，受可能叫"${shouHint}"` : ''}`
      : '';

    const newNamePart = (gongNew || shouNew) ? `
【新名字】攻新名="${gongNew || '未指定'}"，受新名="${shouNew || '未指定'}"
variants.suggested 推导规则（只填称呼字符串，严禁括号和说明）：
- 全名→新全名；单字名/姓→新名对应字；叠字昵称→新名某字叠字；小X/大X/阿X→保留前缀替换X；职位尊称→与original相同
surnameGroups.suggested：把词组中旧姓氏替换为新姓氏，其余不变` : '';

    const prompt = `你是资深耽美/BL/言情小说分析助手。${hintPart}${newNamePart}

请分析小说文本，严格按JSON格式返回：
- summary：400-600字完整剧情梗概
- novelType：如"古言耽美""现代都市"
- gong/shou：mainName主名，variants所有专属称呼（严禁：你/他/她/宝贝/哥/弟等通用词），surnameGroups姓氏词组（如谢家/谢总/谢大哥/谢氏集团，穷举所有出现的组合）
- others：配角最多3个，同结构

{
  "summary":"...",
  "novelType":"...",
  "gong":{"mainName":"...","variants":[{"original":"...","suggested":"..."}],"surnameGroups":[{"original":"谢家","suggested":"陆家"}]},
  "shou":{"mainName":"...","variants":[{"original":"...","suggested":"..."}],"surnameGroups":[{"original":"...","suggested":"..."}]},
  "others":[{"name":"...","variants":[{"original":"...","suggested":"..."}],"surnameGroups":[{"original":"...","suggested":"..."}]}]
}

=== 小说文本 ===
${sampleText}`;

    const responseText = await callDeepSeek([{ role: 'user', content: prompt }]);
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI返回格式异常，请重试');
    const data = JSON.parse(jsonMatch[0]);

    for (const role of [data.gong, data.shou, ...(data.others || [])]) {
      if (!role) continue;
      role.variants = cleanVariants(role.variants);
      role.surnameGroups = cleanSurnameGroups(role.surnameGroups);
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('分析错误:', error);
    return res.status(500).json({ error: error.message || 'AI分析失败，请重试' });
  }
};
