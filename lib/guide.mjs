/**
 * AI collaboration text.
 *
 * The plugin never executes user/AI code. What it offers instead is a precise,
 * copyable brief that teaches an AI the pack and recipe schemas, the current
 * state, and the safety rules — so the AI can author *data* that the plugin
 * validates. This module is the "prompt engineering" half of the plugin.
 */

function code (label, value) {
  return `\n\`\`\`${label}\n${value}\n\`\`\`\n`
}

export function buildGuide (options = {}) {
  const {
    mode = 'overview',
    pack = null,
    packsDir = '',
    workDir = '',
    userRecipeDir = '',
    picks = {},
    recipe = null,
    lang = 'zh',
  } = options

  const zh = lang !== 'en'
  const T = zh ? ZH : EN
  const lines = []
  lines.push(T.title)
  lines.push('')
  lines.push(T.env)
  lines.push(`- packs: ${packsDir}`)
  lines.push(`- user recipes: ${userRecipeDir}`)
  lines.push(`- work: ${workDir}`)
  if (pack !== null) {
    lines.push('')
    lines.push(T.current)
    lines.push(`- pack: ${pack.id} (${pack.title}) at ${pack.dir}`)
    lines.push(`- canvas: ${pack.canvas.width}x${pack.canvas.height}, ${pack.layers.length} layers, ${pack.slots.length} slots`)
    for (const slot of pack.slots) {
      const selected = picks[slot.key]
      const layer = selected === undefined ? undefined : pack.layerById.get(selected)
      lines.push(`- slot ${slot.key} [${slot.mode}] ${slot.label}: ${layer === undefined ? '(none)' : `${layer.name} (${layer.id})`}; members: ${slot.members.join(', ')}`)
    }
    lines.push(`- recipe: ${recipe === null ? '(none)' : `${recipe.label} (${recipe.id})`}`)
  }

  lines.push('')
  lines.push(T.rulesHeading)
  for (const rule of T.rules) lines.push(`- ${rule}`)
  lines.push(T.schemaHeading)
  if (mode === 'recipe' || mode === 'overview') lines.push(T.recipeSchema)
  if (mode === 'pack' || mode === 'overview') lines.push(T.packSchema)
  lines.push(T.tasksHeading)
  lines.push(T.tasks)
  lines.push('')
  lines.push(T.finish)
  return lines.join('\n')
}

const ZH = {
  title: '# 差分工坊（Diff Forge）协作简报',
  env: '## 环境',
  current: '## 当前状态',
  rulesHeading: '## 硬性规则（必须遵守）',
  rules: [
    '只产出数据：素材包 `pack.json`、配方 `recipe.json`、或说明文字。不要产出可执行代码、脚本、安装命令。',
    '配方文件写到上面的 `user recipes` 目录；素材包写到 `packs` 下新建的子目录，每个包必须有 `pack.json`。',
    '路径一律使用相对素材包目录的相对路径；禁止 `..`、绝对路径、网络 URL。',
    '只使用用户提供的、或用户明确有权使用的图片。不要生成、下载或引用任何商业游戏素材、角色名或商标。',
    '数值必须在 schema 允许的范围内；不确定时先问用户，不要瞎猜。',
  ],
  schemaHeading: '## 格式',
  recipeSchema: `配方（recipe）最小示例：
\`\`\`json
{
  "schema": "diff-forge/recipe@1",
  "id": "warm-sunset",
  "label": "暖色黄昏",
  "description": "可选的一句话说明",
  "ops": [
    { "op": "tint", "color": "#ff9a3c", "amount": 0.18 },
    { "op": "brightness", "amount": 0.04 },
    { "op": "saturate", "amount": 1.1 }
  ]
}
\`\`\`
可用 op：tint / brightness / contrast / saturate / grayscale / opacity / flip / shadow / border。
所有 op 按数组顺序执行；最多 32 个。`,
  packSchema: `素材包（pack）最小示例：
\`\`\`json
{
  "schema": "diff-forge/pack@1",
  "id": "my-character",
  "title": "我的角色",
  "canvas": { "width": 1200, "height": 1800 },
  "slots": [
    { "key": "costume", "label": "服装", "mode": "single" },
    { "key": "face", "label": "表情", "mode": "single" },
    { "key": "blush", "label": "红晕", "mode": "toggle" }
  ],
  "layers": [
    { "id": "body-a", "name": "便服", "src": "layers/body-a.png", "slot": "costume", "z": 0 },
    { "id": "face-smile", "name": "微笑", "src": "layers/face-smile.png", "slot": "face", "z": 20, "visible": true },
    { "id": "blush", "name": "红晕", "src": "layers/blush.png", "slot": "blush", "z": 30 }
  ]
}
\`\`\`
图层按 \`z\` 从小到大绘制（小的在后面）；\`x\`/\`y\` 是画布内偏移；\`opacity\` 取 0~1。`,
  tasksHeading: '## 你可以接的任务',
  tasks: `1. **做效果**：根据用户描述写一个 recipe，保存到 user recipes 目录，然后读出路径和它的作用。
2. **做素材包**：用户给出一组带透明通道的 PNG，帮他把图层归到槽位、写 pack.json、检查 IDs 和默认值是否合理。
3. **改结构**：帮用户把现有包拆成更合理的槽位（例如把「表情」和「追加」合并成一个互斥槽位），并说明渲染顺序。
4. **查问题**：根据包目录、图层尺寸和当前选择，定位「重影 / 错位 / 该显示却没显示」的原因，先给诊断再改数据。`,
  finish: `## 交付方式
先用一两句话确认你要做的改动和目标文件路径，再动手。完成后告诉我：改了哪个文件、用面板里的哪个操作验证、以及预期看到什么。若你不能写文件，就输出带文件名的 JSON 代码块，并说明放到哪里。`,
}

const EN = {
  title: '# Diff Forge collaboration brief',
  env: '## Environment',
  current: '## Current state',
  rulesHeading: '## Hard rules',
  rules: [
    'Emit data only: a pack.json, a recipe JSON, or prose. No executable code, scripts, or install commands.',
    'Write recipes into the `user recipes` directory above. Write packs as new subdirectories under `packs`, each with a pack.json.',
    'All paths inside a pack are relative to the pack directory. No `..`, absolute paths, or network URLs.',
    'Use only images the user supplied or clearly has rights to. Do not generate, download, or reference commercial game assets, character names, or trademarks.',
    'Stay inside the documented numeric ranges. Ask before guessing.',
  ],
  schemaHeading: '## Formats',
  recipeSchema: `Minimal recipe:
\`\`\`json
{
  "schema": "diff-forge/recipe@1",
  "id": "warm-sunset",
  "label": "Warm sunset",
  "ops": [
    { "op": "tint", "color": "#ff9a3c", "amount": 0.18 },
    { "op": "brightness", "amount": 0.04 }
  ]
}
\`\`\`
Ops: tint / brightness / contrast / saturate / grayscale / opacity / flip / shadow / border.
They run in array order, at most 32.`,
  packSchema: `Minimal pack:
\`\`\`json
{
  "schema": "diff-forge/pack@1",
  "id": "my-character",
  "title": "My character",
  "canvas": { "width": 1200, "height": 1800 },
  "slots": [
    { "key": "costume", "label": "Costume", "mode": "single" },
    { "key": "face", "label": "Face", "mode": "single" }
  ],
  "layers": [
    { "id": "body-a", "name": "Casual", "src": "layers/body-a.png", "slot": "costume", "z": 0 },
    { "id": "face-smile", "name": "Smile", "src": "layers/face-smile.png", "slot": "face", "z": 20 }
  ]
}
\`\`\`
Lower \`z\` paints first (further back). \`x\`/\`y\` offset inside the canvas; \`opacity\` is 0..1.`,
  tasksHeading: '## Tasks you can take',
  tasks: `1. **Make a look**: write a recipe from the user's description, save it under user recipes, then report the path.
2. **Make a pack**: turn a folder of transparent PNGs into slots + pack.json, with sane defaults.
3. **Refactor**: split or merge slots so exclusivity is correct, and explain paint order.
4. **Debug**: diagnose ghosting, offsets, or invisible layers from the pack directory and current state, then fix the data.`,
  finish: `## Hand-off
Confirm the change and target file in one or two sentences, then do it. Afterwards report which file changed, which panel control verifies it, and what the user should see. If you cannot write files, return a fenced JSON block with the intended filename and where to put it.`,
}

/** Short copyable prompts shown in the panel. */
export function starterPrompts (context = {}) {
  const { pack = null, userRecipeDir = '', packsDir = '' } = context
  const where = pack === null ? '' : `\n目标包：${pack.dir}`
  return [
    {
      id: 'look',
      title: '让 AI 做一套新配色',
      prompt: `你在和我协作使用「差分工坊」。请先读取当前状态和我们的包：${where || `\n包目录：${packsDir}`}\n` +
        `配方写到：${userRecipeDir}\n` +
        '我想要的效果：（在这里描述，例如：黄昏逆光、低饱和、加一圈奶油色描边）。\n' +
        '请只输出一个 recipe JSON（schema diff-forge/recipe@1），先用一句话确认理解，再写文件并告诉我路径。',
    },
    {
      id: 'pack',
      title: '把一组 PNG 做成素材包',
      prompt: `你在和我协作使用「差分工坊」。我要把一组透明 PNG 做成可换装的素材包。\n` +
        `请在 ${packsDir} 下新建一个子目录，写 pack.json，并把图层按「服装 / 表情 / 配饰」归到互斥槽位。\n` +
        '先列出你看到的图片和打算怎么分槽，等我确认后再写文件。不要使用我没有提供的图片。',
    },
    {
      id: 'debug',
      title: '诊断重影或错位',
      prompt: `你在和我协作使用「差分工坊」。当前渲染有问题是：（描述现象，例如：换表情后脸上有重影 / 配饰偏移）。\n` +
        `${where}\n请先读取 pack.json 的 z、x、y、slot 设置和当前选择，给出诊断，再提出最小改动的修复方案。先不要改文件。`,
    },
    {
      id: 'extend',
      title: '给插件加一个新功能',
      prompt: `你在和我协作使用「差分工坊」（一个 DeepSeek Harness 插件）。我想扩展它：\n` +
        '（描述你想要的能力，例如：多配方叠加、导出 GIF、按标签筛选图层）。\n' +
        '请先说明这应该落在哪一层：素材包数据 / recipe 数据 / 插件代码；如果只需要数据，就给我 JSON 方案；如果需要改代码，先给出改动计划，不要直接改。',
    },
  ]
}
