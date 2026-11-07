/**
 * Diff Forge — Client half.
 *
 * A single floating window (shell.overlay) with: pack picker, exclusive-slot
 * selects, data-recipe picker, zoomable preview, PNG export, and an "AI" panel
 * that copies ready-made collaboration prompts. It shares the same selection
 * with the agent tool through /diff-forge/state.
 */

window.__ModuleLoader__.load({
  id: 'dsh-diff-forge',
  factory (require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const API = '/diff-forge'
    const POLL_MS = 1500
    const LAYOUT_KEY = 'diff-forge.layout.v1'
    const MIN_WIDTH = 440
    const MIN_HEIGHT = 500
    const DEFAULT_SIZE = { width: 600, height: 760 }
    const MIN_ZOOM = 1
    const MAX_ZOOM = 6

    const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

    const ZH = {
      title: '差分工坊',
      pack: '素材包',
      slot: '槽位',
      recipe: '配方',
      none: '（无）',
      off: '（关闭）',
      empty: '还没有改动',
      reset: '回到默认',
      save: '保存 PNG',
      fit: '复位',
      compose: '合成中',
      failed: '合成失败',
      recent: 'RECENT',
      hint: '滚轮缩放 · 拖动平移',
      ai: 'AI 协作',
      aiHint: '把下面任意一条发给你的 AI，它就会改数据（素材包 / 配方），不用改插件代码。',
      copy: '复制',
      view: '查看',
      copied: '已复制',
      copyBrief: '复制完整简报',
      brief: '完整简报',
      noPack: '还没有素材包喵。把 pack.json + PNG 放到下面这个目录即可',
      packsDir: '素材包目录',
      examples: '内置示例',
      version: '版本',
      layers: '图层',
      userRecipe: '自建',
      warnings: '提示',
      close: '关闭',
      maximize: '最大化',
      restore: '还原',
      collapse: '收起',
      expand: '展开',
      copyFail: '复制失败，请手动选中文本',
    }

    const EN = {
      title: 'Diff Forge',
      pack: 'PACK',
      slot: 'SLOT',
      recipe: 'RECIPE',
      none: '(none)',
      off: '(off)',
      empty: 'No edits yet',
      reset: 'Reset',
      save: 'Save PNG',
      fit: 'Fit',
      compose: 'Composing',
      failed: 'Composition failed',
      recent: 'RECENT',
      hint: 'Wheel to zoom · drag to pan',
      ai: 'AI collab',
      aiHint: 'Send any card to your AI. It edits data (packs / recipes), never plugin code.',
      copy: 'Copy',
      view: 'View',
      copied: 'Copied',
      copyBrief: 'Copy full brief',
      brief: 'FULL BRIEF',
      noPack: 'No packs yet. Drop pack.json + PNGs here:',
      packsDir: 'Packs dir',
      examples: 'Built-in example',
      version: 'version',
      layers: 'layers',
      userRecipe: 'user',
      warnings: 'Warnings',
      close: 'Close',
      maximize: 'Maximize',
      restore: 'Restore',
      collapse: 'Collapse',
      expand: 'Expand',
      copyFail: 'Copy failed; select the text manually',
    }

    function makeT (ctx) {
      try { ctx.locale.register('diff-forge', 'zh', ZH) } catch { /* ids vary */ }
      try { ctx.locale.register('diff-forge', 'en', EN) } catch { /* ignore */ }
      let translate
      try { translate = ctx.locale.bind('diff-forge') } catch { translate = undefined }
      return (key) => {
        if (translate !== undefined) {
          try {
            const value = translate(key)
            if (typeof value === 'string' && value !== '' && value !== key) return value
          } catch { /* fall through */ }
        }
        return ZH[key] ?? key
      }
    }

    // ------------------------------------------------------------- helpers
    async function call (path, init) {
      try {
        const res = await fetch(`${API}${path}`, {
          credentials: 'same-origin',
          headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
          ...init,
        })
        if (res.headers.get('content-type')?.includes('application/json') === true) {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) return { ok: false, problem: body?.problem ?? `HTTP ${res.status}` }
          return { ok: true, body }
        }
        const text = await res.text()
        if (!res.ok) return { ok: false, problem: `HTTP ${res.status}` }
        return { ok: true, body: text }
      } catch (err) {
        return { ok: false, problem: String(err?.message ?? err) }
      }
    }

    function clamp (value, low, high) {
      return Math.min(high, Math.max(low, value))
    }

    function readToken (name, fallback) {
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
        if (raw === '') return fallback
        const probe = document.createElement('span')
        probe.style.color = raw
        probe.style.display = 'none'
        document.body.appendChild(probe)
        const computed = getComputedStyle(probe).color
        probe.remove()
        return computed === '' ? fallback : computed
      } catch {
        return fallback
      }
    }

    function parseColor (value) {
      const match = /rgba?\(([^)]+)\)/i.exec(value)
      if (match === null) return { r: 16, g: 16, b: 16, a: 1 }
      const parts = match[1].split(/[,/]/).map((x) => Number.parseFloat(x.trim()))
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: Number.isFinite(parts[3]) ? parts[3] : 1 }
    }

    const LIGHT = {
      paper: '#ffffff', ink: '#101010', dim: '#6e6e73',
      line: 'rgba(16,16,16,0.14)', rule: '#101010',
      hover: '#ededed', press: '#dcdcdc', well: '#f7f7f7',
      red: '#e4002b', redHover: '#c50024', yellow: '#ffd100', blue: '#0057b8',
      checkerA: '#eeeeee', checkerB: '#ffffff',
    }
    const DARK = {
      paper: '#141414', ink: '#f2f2f2', dim: '#9a9aa0',
      line: 'rgba(255,255,255,0.18)', rule: 'rgba(242,242,242,0.88)',
      hover: '#262626', press: '#343434', well: '#1c1c1c',
      red: '#ff4b5c', redHover: '#ff6f7d', yellow: '#ffd100', blue: '#4d8dff',
      checkerA: '#202020', checkerB: '#2a2a2a',
    }

    function readPalette () {
      const bg = parseColor(readToken('--dsw-alias-bg-overlay', 'rgb(255,255,255)'))
      const fg = parseColor(readToken('--dsw-alias-label-primary', 'rgb(16,16,16)'))
      // Light/dark follows the surface we actually draw on; a translucent
      // overlay token tells us nothing, so fall back to the label polarity.
      const bgLum = (bg.r + bg.g + bg.b) / 3
      const fgLum = (fg.r + fg.g + fg.b) / 3
      const dark = bg.a >= 0.85 ? bgLum < 128 : fgLum >= 128
      const base = dark ? DARK : LIGHT
      const opaque = bg.a >= 0.85 ? `rgba(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)},${bg.a})` : base.paper
      return { ...base, paper: opaque, ink: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`, dark }
    }

    function samePalette (a, b) {
      return a.paper === b.paper && a.ink === b.ink && a.dark === b.dark
    }

    function usePalette () {
      const [palette, setPalette] = useState(readPalette)
      useEffect(() => {
        const update = () => {
          const next = readPalette()
          setPalette((current) => (samePalette(current, next) ? current : next))
        }
        update()
        const observer = new MutationObserver(update)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
        return () => observer.disconnect()
      }, [])
      return palette
    }

    function loadLayout () {
      try {
        const raw = localStorage.getItem(LAYOUT_KEY)
        if (raw === null) return {}
        const parsed = JSON.parse(raw)
        const layout = {}
        if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') {
          layout.pos = { left: parsed.left, top: parsed.top }
        }
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          layout.size = { width: parsed.width, height: parsed.height }
        }
        return layout
      } catch {
        return {}
      }
    }

    function saveLayout (pos, size) {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({
          left: Math.round(pos.left),
          top: Math.round(pos.top),
          width: Math.round(size.width),
          height: Math.round(size.height),
        }))
      } catch { /* ignore */ }
    }

    function glyph (path, size = 14) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'square',
        'aria-hidden': true, style: { display: 'block' },
      }, h('path', { d: path }))
    }

    const HANDLES = [
      ['n', { top: -2, left: -2, right: -2, height: 8, cursor: 'ns-resize' }],
      ['s', { bottom: -2, left: -2, right: -2, height: 8, cursor: 'ns-resize' }],
      ['w', { left: -2, top: -2, bottom: -2, width: 8, cursor: 'ew-resize' }],
      ['e', { right: -2, top: -2, bottom: -2, width: 8, cursor: 'ew-resize' }],
      ['nw', { left: -2, top: -2, width: 16, height: 16, cursor: 'nwse-resize' }],
      ['ne', { right: -2, top: -2, width: 16, height: 16, cursor: 'nesw-resize' }],
      ['sw', { left: -2, bottom: -2, width: 16, height: 16, cursor: 'nesw-resize' }],
      ['se', { right: -2, bottom: -2, width: 16, height: 16, cursor: 'nwse-resize' }],
    ]

    // ------------------------------------------------------------ component
    function ForgeDesk (props) {
      const t = props.__t
      const palette = usePalette()
      const [state, setState] = useState(null)
      const [problem, setProblem] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')
      const [aiOpen, setAiOpen] = useState(false)
      const [guideText, setGuideText] = useState('')
      const [maximized, setMaximized] = useState(false)
      const [collapsed, setCollapsed] = useState(false)
      const [imageState, setImageState] = useState('idle')
      const [zoom, setZoom] = useState(1)
      const [pan, setPan] = useState({ x: 0, y: 0 })
      const [panning, setPanning] = useState(false)
      const versionRef = useRef(-1)
      const packRef = useRef(null)
      const panelRef = useRef(null)
      const stageRef = useRef(null)
      const dragRef = useRef(null)
      const resizeRef = useRef(null)
      const panRef = useRef(null)
      const toastTimer = useRef(null)
      const restoreRef = useRef(null)
      const zoomRef = useRef(1)
      const panOffsetRef = useRef({ x: 0, y: 0 })

      const initial = useMemo(loadLayout, [])
      const [pos, setPos] = useState(() => initial.pos ?? {
        left: Math.max(12, Math.round((window.innerWidth - DEFAULT_SIZE.width) / 2)),
        top: 72,
      })
      const [size, setSize] = useState(() => {
        const saved = initial.size ?? DEFAULT_SIZE
        return {
          width: clamp(saved.width, MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 24)),
          height: clamp(saved.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 24)),
        }
      })

      const applyView = useCallback((nextZoom, nextPan) => {
        zoomRef.current = nextZoom
        panOffsetRef.current = nextPan
        setZoom(nextZoom)
        setPan(nextPan)
      }, [])

      const resetView = useCallback(() => applyView(1, { x: 0, y: 0 }), [applyView])

      const flash = useCallback((text) => {
        setToast(text)
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(''), 1800)
      }, [])

      const refresh = useCallback(async () => {
        const res = await call(`/state?since=${versionRef.current}`)
        if (!res.ok) { setProblem(res.problem); return }
        if (res.body?.unchanged === true) return
        setProblem('')
        setState((current) => {
          if (current !== null && current.state?.version === res.body.state?.version) return current
          return res.body
        })
        if (res.body?.state?.version !== undefined) {
          if (versionRef.current !== res.body.state.version) setImageState('loading')
          versionRef.current = res.body.state.version
        }
      }, [])

      useEffect(() => { refresh() }, [refresh])

      useEffect(() => {
        const timer = setInterval(() => { refresh() }, POLL_MS)
        return () => clearInterval(timer)
      }, [refresh])

      useEffect(() => () => {
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
      }, [])

      const mutate = useCallback(async (payload, options) => {
        setBusy(true)
        const res = await call('/set', { method: 'POST', body: JSON.stringify({ ...payload, actor: 'user' }) })
        setBusy(false)
        if (!res.ok) { setProblem(res.problem); return }
        setProblem('')
        setState(res.body)
        if (res.body?.state?.version !== undefined) {
          versionRef.current = res.body.state.version
          setImageState('loading')
        }
        if (options?.rezoom === true) resetView()
      }, [resetView])

      const copyText = useCallback(async (text) => {
        if (typeof text !== 'string' || text === '') return
        try {
          await navigator.clipboard.writeText(text)
          flash(t('copied'))
          return
        } catch { /* fall back to a hidden textarea */ }
        try {
          const area = document.createElement('textarea')
          area.value = text
          area.setAttribute('readonly', 'readonly')
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          area.remove()
          flash(t('copied'))
        } catch {
          flash(t('copyFail'))
        }
      }, [flash, t])

      const copyBrief = useCallback(async () => {
        const res = await call('/prompt?mode=overview')
        if (!res.ok) { setProblem(res.problem); return }
        setGuideText(res.body)
        await copyText(res.body)
      }, [copyText])

      const loadGuide = useCallback(async () => {
        if (guideText !== '') return
        const res = await call('/prompt?mode=overview')
        if (res.ok) setGuideText(res.body)
      }, [guideText])

      useEffect(() => {
        if (aiOpen) loadGuide()
      }, [aiOpen, loadGuide])

      // ---- preview zoom / pan ----
      // The preview is letterboxed (object-fit: contain), so the pannable
      // range has to follow the drawn image, not the stage box. Clamping to
      // rect * (zoom - 1) let the portrait slide out and show empty corners.
      const viewLimits = useCallback((rect, zoom) => {
        const canvas = packRef.current?.canvas
        const cw = canvas?.width ?? rect.width
        const ch = canvas?.height ?? rect.height
        const fit = Math.min(rect.width / cw, rect.height / ch)
        return {
          x: Math.max(0, (cw * fit * zoom - rect.width) / 2),
          y: Math.max(0, (ch * fit * zoom - rect.height) / 2),
        }
      }, [])

      useEffect(() => {
        const stage = stageRef.current
        if (stage === null) return undefined
        const onWheel = (event) => {
          const rect = stage.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return
          const current = zoomRef.current
          const base = panOffsetRef.current
          const factor = Math.exp(-event.deltaY * 0.0016)
          const next = clamp(current * factor, MIN_ZOOM, MAX_ZOOM)
          if (Math.abs(next - current) < 0.0005) return
          event.preventDefault()
          const cursorX = event.clientX - rect.left
          const cursorY = event.clientY - rect.top
          const contentX = (cursorX - base.x) / current
          const contentY = (cursorY - base.y) / current
          const wanted = { x: cursorX - contentX * next, y: cursorY - contentY * next }
          const limits = viewLimits(rect, next)
          applyView(next, {
            x: clamp(wanted.x, -limits.x, limits.x),
            y: clamp(wanted.y, -limits.y, limits.y),
          })
        }
        stage.addEventListener('wheel', onWheel, { passive: false })
        return () => stage.removeEventListener('wheel', onWheel)
      }, [applyView, viewLimits])

      const panStart = useCallback((event) => {
        if (event.button !== 0 || zoomRef.current <= MIN_ZOOM) return
        panRef.current = {
          x: event.clientX, y: event.clientY,
          panX: panOffsetRef.current.x, panY: panOffsetRef.current.y,
        }
        setPanning(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }, [])

      const panMove = useCallback((event) => {
        const origin = panRef.current
        if (origin === null) return
        const rect = stageRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        const limits = viewLimits(rect, zoomRef.current)
        applyView(zoomRef.current, {
          x: clamp(origin.panX + (event.clientX - origin.x), -limits.x, limits.x),
          y: clamp(origin.panY + (event.clientY - origin.y), -limits.y, limits.y),
        })
      }, [applyView, viewLimits])

      const panEnd = useCallback(() => {
        panRef.current = null
        setPanning(false)
      }, [])

      // ---- window drag / resize ----
      const dragStart = useCallback((event) => {
        if (event.button !== 0) return
        const rect = panelRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        dragRef.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
        event.currentTarget.setPointerCapture(event.pointerId)
      }, [])

      const dragMove = useCallback((event) => {
        const origin = dragRef.current
        if (origin === null) return
        const width = panelRef.current?.offsetWidth ?? size.width
        setPos({
          left: clamp(origin.left + (event.clientX - origin.x), 12 - width + 80, window.innerWidth - 80),
          top: clamp(origin.top + (event.clientY - origin.y), 8, window.innerHeight - 40),
        })
      }, [size.width])

      const dragEnd = useCallback(() => {
        if (dragRef.current === null) return
        dragRef.current = null
        const rect = panelRef.current?.getBoundingClientRect()
        if (rect !== undefined) saveLayout({ left: rect.left, top: rect.top }, { width: rect.width, height: rect.height })
      }, [])

      const resizeStart = useCallback((event, direction) => {
        if (event.button !== 0) return
        const rect = panelRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        resizeRef.current = {
          direction,
          x: event.clientX,
          y: event.clientY,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }, [])

      const resizeMove = useCallback((event) => {
        const origin = resizeRef.current
        if (origin === null) return
        const dx = event.clientX - origin.x
        const dy = event.clientY - origin.y
        let { left, top, width, height } = origin
        if (origin.direction.includes('e')) width = clamp(origin.width + dx, MIN_WIDTH, window.innerWidth - 24)
        if (origin.direction.includes('s')) height = clamp(origin.height + dy, MIN_HEIGHT, window.innerHeight - 24)
        if (origin.direction.includes('w')) {
          width = clamp(origin.width - dx, MIN_WIDTH, origin.left + origin.width - 8)
          left = origin.left + origin.width - width
        }
        if (origin.direction.includes('n')) {
          height = clamp(origin.height - dy, MIN_HEIGHT, origin.top + origin.height - 8)
          top = origin.top + origin.height - height
        }
        setPos({ left, top })
        setSize({ width, height })
      }, [])

      const resizeEnd = useCallback(() => {
        if (resizeRef.current === null) return
        resizeRef.current = null
        const rect = panelRef.current?.getBoundingClientRect()
        if (rect !== undefined) saveLayout({ left: rect.left, top: rect.top }, { width: rect.width, height: rect.height })
      }, [])

      const toggleMaximize = useCallback(() => {
        const rect = panelRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        if (!maximized) {
          restoreRef.current = { pos: { left: rect.left, top: rect.top }, size: { width: rect.width, height: rect.height } }
          setPos({ left: 16, top: 60 })
          setSize({
            width: Math.max(MIN_WIDTH, window.innerWidth - 32),
            height: Math.max(MIN_HEIGHT, window.innerHeight - 76),
          })
          setMaximized(true)
        } else {
          const back = restoreRef.current
          if (back !== null) {
            setPos(back.pos)
            setSize(back.size)
          }
          setMaximized(false)
        }
      }, [maximized])

      // ---- derived ----
      const pack = state?.pack ?? null
      packRef.current = pack
      const packs = state?.packs ?? []
      const current = state?.state ?? null
      const slots = pack?.slots ?? []
      const recipes = pack?.recipes ?? []
      const suggestions = state?.suggestions ?? []
      const warnings = state?.problems ?? []
      const version = current?.version ?? 0
      const requestWidth = useMemo(() => {
        const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
        const raw = (size.width - 30) * dpr
        return Math.round(clamp(raw, 600, 2000) / 100) * 100
      }, [size.width])

      const labelStyle = {
        width: '58px', flex: '0 0 58px',
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.11em',
        textTransform: 'uppercase', color: palette.dim,
      }
      const selectStyle = {
        flex: '1 1 auto', minWidth: 0, height: '26px',
        fontSize: '12px', padding: '0 6px',
        color: palette.ink, background: palette.paper,
        border: `1px solid ${palette.line}`, borderRadius: 0,
        fontFamily: FONT, cursor: 'pointer',
      }
      const ghostButton = {
        appearance: 'none', border: `1px solid ${palette.line}`, background: palette.paper,
        color: palette.ink, cursor: 'pointer', fontSize: '11px', fontFamily: FONT,
        letterSpacing: '0.03em', padding: '5px 12px', borderRadius: 0, flex: '0 0 auto',
      }
      const primaryButton = {
        appearance: 'none', border: 'none', background: palette.red, color: '#ffffff',
        cursor: 'pointer', fontSize: '11px', fontWeight: 600, fontFamily: FONT,
        letterSpacing: '0.05em', padding: '6px 14px', borderRadius: 0, flex: '0 0 auto',
        textDecoration: 'none', display: 'inline-block',
      }
      const field = (key, label, content) => h('div', {
        key,
        style: {
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '0 14px', minHeight: '38px',
          borderBottom: `1px solid ${palette.line}`,
        },
      }, h('span', { style: labelStyle }, label), content)

      const packOptions = packs.map((entry) => h('option', {
        key: entry.slug,
        value: entry.slug,
        disabled: entry.problem !== undefined,
      }, entry.problem === undefined
        ? `${entry.title}  · ${entry.slug}`
        : `⚠ ${entry.slug}  ${entry.problem}`))

      const packRow = field('pack', t('pack'), h('select', {
        disabled: busy || packs.length === 0,
        value: pack?.slug ?? '',
        onChange: (event) => mutate({ op: 'pack', pack: event.target.value }, { rezoom: true }),
        style: selectStyle,
      }, packs.length === 0 ? h('option', { value: '' }, t('none')) : packOptions))

      const slotRows = slots.map((slot) => {
        const isToggle = slot.mode === 'toggle'
        const selected = current?.picks?.[slot.key] ?? ''
        const option = (member) => h('option', { key: member.id, value: member.id }, member.name)
        const options = Array.isArray(slot.groups) && slot.groups.length > 1
          ? slot.groups.map((group) => h('optgroup', {
            key: group.label,
            label: group.label,
          }, ...group.members.map((id) => slot.members.find((member) => member.id === id)).filter(Boolean).map(option)))
          : slot.members.map(option)
        return field(`slot:${slot.key}`, slot.label, h('select', {
          disabled: busy,
          value: selected,
          onChange: (event) => mutate({
            op: 'pick',
            slot: slot.key,
            layer: event.target.value === '' ? null : event.target.value,
          }),
          style: selectStyle,
        },
          isToggle ? h('option', { value: '' }, t('off')) : null,
          ...options,
        ))
      })

      const recipeRow = recipes.length === 0 && pack === null ? null : field('recipe', t('recipe'), h('select', {
        disabled: busy,
        value: current?.recipe ?? '',
        onChange: (event) => mutate({ op: 'recipe', recipe: event.target.value }),
        style: selectStyle,
      },
        h('option', { value: '' }, t('none')),
        ...recipes.map((entry) => h('option', { key: entry.id, value: entry.id },
          `${entry.label}${entry.source === 'user' ? ` · ${t('userRecipe')}` : ''}`)),
      ))

      const warningLine = warnings.length === 0 ? null : h('div', {
        style: {
          padding: '6px 12px', fontSize: '10.5px', color: palette.red,
          borderBottom: `1px solid ${palette.line}`, letterSpacing: '0.02em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
        title: warnings.join('\n'),
      }, `${t('warnings')}: ${warnings[0]}`)

      const stage = h('div', {
        ref: stageRef,
        onPointerDown: panStart,
        onPointerMove: panMove,
        onPointerUp: panEnd,
        onPointerCancel: panEnd,
        onDoubleClick: resetView,
        style: {
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          width: '100%',
          borderBottom: `2px solid ${palette.rule}`,
          backgroundColor: palette.checkerB,
          backgroundImage: `linear-gradient(45deg, ${palette.checkerA} 25%, transparent 25%), linear-gradient(-45deg, ${palette.checkerA} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${palette.checkerA} 75%), linear-gradient(-45deg, transparent 75%, ${palette.checkerA} 75%)`,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
          overflow: 'hidden',
          cursor: zoom > MIN_ZOOM ? (panning ? 'grabbing' : 'grab') : 'default',
          touchAction: 'none',
        },
      },
        h('div', {
          style: {
            width: '100%', height: '100%',
            transformOrigin: '0 0',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            willChange: zoom === MIN_ZOOM ? 'auto' : 'transform',
          },
        },
          pack === null
            ? h('div', {
              style: {
                height: '100%', display: 'grid', placeItems: 'center', padding: '20px',
                color: palette.dim, fontSize: '11px', lineHeight: 1.7, textAlign: 'center',
              },
            }, h('div', null,
              h('div', { style: { marginBottom: '8px' } }, t('noPack')),
              h('code', {
                style: {
                  display: 'block', fontSize: '10.5px', color: palette.ink,
                  background: palette.well, padding: '6px 8px', wordBreak: 'break-all',
                  border: `1px solid ${palette.line}`,
                },
              }, state?.dirs?.packs ?? 'packs/'),
            ))
            : h('img', {
              alt: pack.title,
              src: `${API}/render.png?v=${version}&w=${requestWidth}`,
              draggable: false,
              onLoad: () => setImageState('ready'),
              onError: () => setImageState('error'),
              style: {
                display: 'block', width: '100%', height: '100%', objectFit: 'contain',
                opacity: imageState === 'error' ? 0 : 1,
                WebkitUserDrag: 'none',
              },
            }),
        ),
        h('div', {
          style: {
            position: 'absolute', left: 0, bottom: 0,
            display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'none',
          },
        },
          h('span', {
            style: {
              fontSize: '10px', letterSpacing: '0.08em', color: palette.ink,
              fontVariantNumeric: 'tabular-nums', background: palette.paper,
              borderTop: `1px solid ${palette.line}`, borderRight: `1px solid ${palette.line}`,
              padding: '2px 7px',
            },
          }, imageState === 'loading' || imageState === 'idle'
            ? t('compose')
            : `${Math.round(zoom * 100)}%`),
        ),
        zoom > MIN_ZOOM
          ? h('button', {
            title: t('fit'), className: 'df-btn',
            style: {
              position: 'absolute', right: 0, bottom: 0,
              appearance: 'none', border: 'none',
              borderTop: `1px solid ${palette.line}`, borderLeft: `1px solid ${palette.line}`,
              background: palette.paper, color: palette.ink,
              width: '26px', height: '22px', display: 'grid', placeItems: 'center',
              padding: 0, cursor: 'pointer', borderRadius: 0,
            },
            onClick: resetView,
          }, glyph('M13 8a5 5 0 1 1-1.6-3.7M13 1.8v3.4h-3.4', 12))
          : null,
        h('div', {
          style: {
            position: 'absolute', right: '8px', top: '6px',
            fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase',
            color: palette.dim, opacity: 0.7, pointerEvents: 'none',
          },
        }, zoom === MIN_ZOOM ? t('hint') : ''),
      )

      const aiOverlay = !aiOpen ? null : h('div', {
        style: {
          position: 'absolute', inset: 0, zIndex: 20,
          background: palette.paper,
          display: 'flex', flexDirection: 'column',
        },
      },
        h('div', {
          style: {
            flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '8px',
            padding: '9px 14px', borderBottom: `2px solid ${palette.rule}`,
          },
        },
          h('span', {
            style: {
              flex: '0 0 auto', whiteSpace: 'nowrap',
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.11em',
              textTransform: 'uppercase', color: palette.dim,
            },
          }, t('ai')),
          h('span', {
            style: {
              flex: '1 1 auto', minWidth: 0, fontSize: '10px', color: palette.dim,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
          }, pack === null ? '' : `${pack.title} · ${t('aiHint')}`),
          h('button', {
            className: 'df-btn', style: ghostButton,
            onClick: copyBrief,
          }, t('copyBrief')),
          h('button', {
            className: 'df-btn', style: ghostButton,
            onClick: () => setAiOpen(false),
          }, t('close')),
        ),
        h('div', {
          style: {
            flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
            padding: '10px 14px 14px', display: 'grid', gap: '9px',
            alignContent: 'start',
          },
        },
          h('div', {
            style: { fontSize: '10.5px', lineHeight: 1.6, color: palette.dim },
          }, t('aiHint')),
          ...suggestions.map((item) => {
            const excerpt = String(item.prompt ?? '').replace(/\s+/g, ' ').slice(0, 150)
            return h('div', {
              key: item.id,
              style: {
                border: `1px solid ${palette.line}`, padding: '8px 10px',
                display: 'grid', gap: '6px',
              },
            },
              h('div', {
                style: { display: 'flex', alignItems: 'center', gap: '8px' },
              },
                h('span', { style: { flex: '1 1 auto', fontSize: '11.5px', fontWeight: 600 } }, item.title),
                h('button', {
                  className: 'df-btn', style: ghostButton,
                  onClick: () => setGuideText(item.prompt ?? ''),
                }, t('view')),
                h('button', {
                  className: 'df-btn', style: ghostButton,
                  onClick: () => copyText(item.prompt ?? ''),
                }, t('copy')),
              ),
              h('div', {
                style: {
                  fontSize: '10px', lineHeight: 1.55, color: palette.dim,
                  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', wordBreak: 'break-word',
                },
              }, excerpt),
            )
          }),
          h('div', {
            style: {
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.11em',
              textTransform: 'uppercase', color: palette.dim, marginTop: '2px',
            },
          }, t('brief')),
          h('textarea', {
            readOnly: true,
            value: guideText,
            placeholder: t('copyBrief'),
            style: {
              width: '100%', minHeight: '240px', resize: 'vertical',
              fontSize: '10.5px', lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              color: palette.ink, background: palette.well,
              border: `1px solid ${palette.line}`, borderRadius: 0, padding: '8px',
            },
          }),
        ),
      )

      const controls = h('div', {
        style: {
          display: 'grid', alignContent: 'start',
          flex: '0 0 auto', minHeight: 0,
          maxHeight: `${Math.round(size.height * 0.46)}px`,
          overflowY: 'auto',
        },
      },
        problem !== '' ? h('div', {
          style: {
            padding: '6px 12px', fontSize: '10.5px', color: palette.red,
            borderBottom: `1px solid ${palette.line}`, letterSpacing: '0.02em',
          },
        }, problem) : null,
        warningLine,
        packRow,
        ...slotRows,
        recipeRow,
      )

      const body = h('div', {
        style: {
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }, stage, controls, aiOverlay)

      const logLine = current?.log?.length > 0
        ? current.log.slice(-1).map((entry) => `${entry.by} ${entry.text}`).join('')
        : t('empty')

      const footer = h('div', {
        style: {
          flex: '0 0 auto', marginTop: 'auto',
          borderTop: `2px solid ${palette.rule}`,
          padding: '8px 12px 12px',
          display: 'flex', alignItems: 'center', gap: '8px',
        },
      },
        h('div', {
          style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
        },
          h('span', {
            style: {
              fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: palette.dim,
            },
          }, toast !== '' ? toast : t('recent')),
          h('span', {
            style: {
              fontSize: '10.5px', color: palette.dim, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            },
          }, logLine),
        ),
        h('button', {
          className: 'df-btn', style: ghostButton, disabled: busy || pack === null,
          onClick: () => mutate({ op: 'reset' }),
        }, t('reset')),
        h('button', {
          className: 'df-btn', style: ghostButton, disabled: pack === null,
          onClick: () => setAiOpen((value) => !value),
        }, t('ai')),
        h('a', {
          className: 'df-primary',
          href: `${API}/export.png?w=2400`,
          download: `${pack?.slug ?? 'diff-forge'}.png`,
          style: { ...primaryButton, opacity: pack === null ? 0.5 : 1, pointerEvents: pack === null ? 'none' : 'auto' },
        }, t('save')),
      )

      const headButtonStyle = {
        appearance: 'none', border: 'none', background: 'transparent',
        color: palette.ink, width: '22px', height: '22px', padding: 0,
        cursor: 'pointer', display: 'grid', placeItems: 'center',
      }

      const head = h('div', {
        onPointerDown: dragStart,
        onPointerMove: dragMove,
        onPointerUp: dragEnd,
        onPointerCancel: dragEnd,
        onDoubleClick: () => {
          if (collapsed) setCollapsed(false)
          else toggleMaximize()
        },
        style: {
          flex: '0 0 auto', height: '34px', display: 'flex', alignItems: 'center',
          padding: '0 10px 0 12px', gap: '8px', cursor: 'move', userSelect: 'none',
          borderBottom: `2px solid ${palette.rule}`, background: palette.paper,
        },
      },
        h('span', {
          style: {
            width: '8px', height: '8px', background: palette.red,
            display: 'inline-block', flex: '0 0 8px',
          },
        }),
        h('span', {
          style: {
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.03em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, pack === null ? t('title') : `${pack.title}`),
        h('span', {
          style: {
            flex: '1 1 auto', fontSize: '9px', letterSpacing: '0.1em',
            textTransform: 'uppercase', color: palette.dim,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, pack === null ? '' : `${pack.slug} · ${pack.canvas.width}×${pack.canvas.height} · ${pack.layerCount} ${t('layers')} · v${version}`),
        collapsed
          ? null
          : h('button', {
            title: maximized ? t('restore') : t('maximize'),
            onPointerDown: (event) => event.stopPropagation(),
            onDoubleClick: (event) => event.stopPropagation(),
            onClick: toggleMaximize,
            style: headButtonStyle,
          }, glyph(maximized ? 'M6 3h7v7M10 6H3v7h7' : 'M3 6V3h3M13 10v3h-3', 12)),
        h('button', {
          title: collapsed ? t('expand') : t('collapse'),
          onPointerDown: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
          onClick: () => setCollapsed((value) => !value),
          style: headButtonStyle,
        }, glyph(collapsed ? 'M3 9.5l5-4 5 4' : 'M3 6.5l5 4 5-4', 12)),
      )

      const band = h('div', { style: { height: '4px', display: 'flex', flex: '0 0 auto' } },
        h('span', { style: { flex: '1', background: palette.red } }),
        h('span', { style: { flex: '1', background: palette.yellow } }),
        h('span', { style: { flex: '1', background: palette.blue } }),
      )

      const panelStyle = {
        position: 'fixed',
        left: `${Math.round(pos.left)}px`,
        top: `${Math.round(pos.top)}px`,
        zIndex: 2147482001,
        width: `${Math.round(size.width)}px`,
        height: `${Math.round(size.height)}px`,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0,
        border: `2px solid ${palette.rule}`,
        background: palette.paper,
        color: palette.ink,
        colorScheme: palette.dark ? 'dark' : 'light',
        fontFamily: FONT,
        boxShadow: '0 18px 50px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }

      const css = `
        .df-desk .df-btn { transition: background-color 100ms ease, border-color 100ms ease; }
        .df-desk .df-btn:hover:not(:disabled) { background-color: ${palette.hover} !important; border-color: ${palette.ink} !important; }
        .df-desk .df-btn:active:not(:disabled) { background-color: ${palette.press} !important; }
        .df-desk .df-primary { transition: background-color 100ms ease; }
        .df-desk .df-primary:hover { background-color: ${palette.redHover} !important; }
        .df-desk ::-webkit-scrollbar { width: 8px; height: 8px; }
        .df-desk ::-webkit-scrollbar-thumb { background: ${palette.line}; }
        .df-desk ::-webkit-scrollbar-thumb:hover { background: ${palette.dim}; }
      `

      if (collapsed) {
        return h('div', {
          ref: panelRef, className: 'df-desk',
          style: { ...panelStyle, height: 'auto' },
        }, h('style', null, css), head, band)
      }

      const handles = maximized
        ? null
        : HANDLES.map(([direction, style]) => h('div', {
          key: direction,
          onPointerDown: (event) => resizeStart(event, direction),
          onPointerMove: resizeMove,
          onPointerUp: resizeEnd,
          onPointerCancel: resizeEnd,
          style: { position: 'absolute', zIndex: 10, ...style, background: 'transparent' },
        }))

      return h('div', { ref: panelRef, className: 'df-desk', style: panelStyle },
        h('style', null, css), head, band, body, footer, handles)
    }

    return {
      inject: ['slots'],
      apply (ctx) {
        const t = makeT(ctx)
        function Desk () {
          return h(ForgeDesk, { __t: t })
        }
        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'diff-forge', order: 44, label: () => t('title') },
          Desk,
        ))
      },
    }
  },
})
