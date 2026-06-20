import { useEffect, useRef, useState } from 'react'

export default function SnapshotDialogue({ backendInfo }) {
  const [message, setMessage] = useState('What stands out visually, and what should I improve?')
  const [screenshot, setScreenshot] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const setImageFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const png = await imageFileToPng(file)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setScreenshot(png)
    setPreviewUrl(URL.createObjectURL(png))
    setError('')
  }

  const handlePaste = async (event) => {
    const item = [...(event.clipboardData?.items || [])].find(entry => entry.type.startsWith('image/'))
    if (!item) return
    event.preventDefault()
    await setImageFile(item.getAsFile())
  }

  const submit = async () => {
    const prompt = message.trim()
    if ((!prompt && !screenshot) || loading) return
    setLoading(true)
    setError('')

    const userItem = {
      role: 'user',
      text: prompt || 'Analyze this screenshot.',
      previewUrl,
    }
    setItems(prev => [...prev, userItem])

    try {
      const form = new FormData()
      form.append('message', prompt)
      if (screenshot) form.append('screenshot', screenshot, screenshot.name || 'screenshot.png')

      const res = await fetch('/vision-chat', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setItems(prev => [...prev, { role: 'assistant', ...data }])
    } catch (err) {
      setError(err.message || 'Vision chat failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-[360px_minmax(0,1fr)] gap-5">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-fit sticky top-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Screenshot Chat</h2>
          {backendInfo?.vision_model && (
            <span className="text-[10px] text-gray-500 font-mono">{backendInfo.vision_model}</span>
          )}
        </div>

        <div
          onPaste={handlePaste}
          onDrop={async (event) => {
            event.preventDefault()
            setDragging(false)
            await setImageFile(event.dataTransfer?.files?.[0])
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => inputRef.current?.focus()}
          className={`border border-dashed rounded-lg p-3 bg-gray-950 transition ${dragging ? 'border-violet-500' : 'border-gray-700'}`}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="Screenshot preview" className="w-full max-h-48 object-contain rounded-md border border-gray-800 bg-black" />
          ) : (
            <div className="h-36 flex items-center justify-center text-sm text-gray-500 text-center">
              Paste or drop a screenshot
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => setImageFile(event.target.files?.[0])}
          />
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 w-full border border-gray-700 hover:bg-gray-800 text-gray-300 py-2 px-3 rounded-lg text-xs transition"
        >
          Upload Screenshot
        </button>

        <textarea
          ref={inputRef}
          value={message}
          onPaste={handlePaste}
          onChange={event => setMessage(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit()
          }}
          placeholder="Ask what users notice first, where attention leaks, or what to change."
          className="mt-3 w-full h-32 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
        />

        <button
          onClick={submit}
          disabled={(!message.trim() && !screenshot) || loading}
          className="mt-3 w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? 'Analyzing...' : 'Ask'}
        </button>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setScreenshot(null)
              if (previewUrl) URL.revokeObjectURL(previewUrl)
              setPreviewUrl('')
            }}
            className="flex-1 border border-gray-700 hover:bg-gray-800 text-gray-400 py-2 px-3 rounded-lg text-xs transition"
          >
            Clear Image
          </button>
          <button
            type="button"
            onClick={() => setItems([])}
            className="flex-1 border border-gray-700 hover:bg-gray-800 text-gray-400 py-2 px-3 rounded-lg text-xs transition"
          >
            New Chat
          </button>
        </div>

        {error && <div className="mt-3 text-xs text-red-300 bg-red-950/30 border border-red-900 rounded-lg p-2">{error}</div>}
      </div>

      <div className="space-y-4">
        {items.length === 0 && (
          <div className="border border-gray-800 rounded-xl bg-gray-900/60 h-[520px] flex items-center justify-center text-gray-600 text-sm">
            Screenshot analysis will appear here
          </div>
        )}

        {items.map((item, idx) => (
          <div key={idx} className={`rounded-xl border p-4 ${
            item.role === 'user'
              ? 'border-gray-800 bg-gray-900'
              : 'border-violet-900/60 bg-violet-950/20'
          }`}>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
              {item.role === 'user' ? 'You' : 'Visual Cortex Flow'}
            </div>
            {item.text && <p className="text-sm text-gray-200 whitespace-pre-wrap">{item.text}</p>}

            {item.previewUrl && (
              <img src={item.previewUrl} alt="Uploaded screenshot" className="mt-3 w-full rounded-lg border border-gray-800 bg-black" />
            )}

            {item.saliency_overlay_base64 && (
              <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
                {item.source_image_base64 && (
                  <Figure title="Original" src={`data:image/png;base64,${item.source_image_base64}`} />
                )}
                <Figure title="Saliency Overlay" src={`data:image/png;base64,${item.saliency_overlay_base64}`} />
              </div>
            )}

            {item.saliency?.hotspots?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.saliency.hotspots.slice(0, 6).map(hotspot => (
                  <span key={hotspot.rank} className="text-[11px] px-2 py-1 rounded bg-cyan-950/60 border border-cyan-900/60 text-cyan-200">
                    #{hotspot.rank} {Math.round(hotspot.score * 100)}%
                  </span>
                ))}
              </div>
            )}

            {item.neural_regions && (
              <div className="mt-3 grid grid-cols-3 md:grid-cols-5 gap-2">
                {Object.entries(item.neural_regions).map(([name, value]) => (
                  <div key={name} className="bg-gray-950 border border-gray-800 rounded p-2">
                    <div className="text-[10px] text-gray-500">{name}</div>
                    <div className="text-xs text-green-300 font-mono">{Number(value).toFixed(3)}</div>
                  </div>
                ))}
              </div>
            )}

            {item.warnings?.length > 0 && (
              <div className="mt-3 text-[11px] text-amber-300 bg-amber-950/20 border border-amber-900/50 rounded p-2">
                {item.warnings[0]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Figure({ title, src }) {
  return (
    <figure>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{title}</div>
      <img src={src} alt={title} className="w-full rounded-lg border border-gray-800 bg-black" />
    </figure>
  )
}

async function imageFileToPng(file) {
  if (file.type === 'image/png') return file
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not convert image')), 'image/png')
    })
    const name = file.name ? file.name.replace(/\.[^.]+$/, '.png') : 'screenshot.png'
    return new File([blob], name, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = src
  })
}
