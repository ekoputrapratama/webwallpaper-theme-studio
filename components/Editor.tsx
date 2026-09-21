"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { uploadVideoToStorage, MULTIPART_SAFE_LIMIT, type VideoUpload } from "@/lib/client-upload";

type ThemeMeta = {
  id: string;
  type: "html" | "video";
  name: string;
  description: string;
  author: string;
  version: string;
  thumbnail: string;
  entry: string;
  video: string | null;
  updatedAt: string;
};

type Toast = { msg: string; kind: "ok" | "error" };

const PREFERRED = ["index.html", "style.css", "script.js"];

function safeParse(body: string): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function themeContent(meta: ThemeMeta): string {
  const lines = ["[Theme]"];
  lines.push(`name=${meta.name || "Untitled Theme"}`);
  if (meta.description) lines.push(`description=${meta.description}`);
  if (meta.author) lines.push(`author=${meta.author}`);
  if (meta.version) lines.push(`version=${meta.version}`);
  lines.push(`thumbnail=${meta.thumbnail || ""}`);
  lines.push(`entry=${meta.entry || "index.html"}`);
  return lines.join("\n") + "\n";
}

function buildPreviewHtml(files: Record<string, string>, id: string): string {
  const src = files["index.html"] ?? "";
  let html = src;

  html = html.replace(/<link\b([^>]*?)href=(["'])([^"']+)\2([^>]*?)\/?>/gi, (m, _pre, _q, href) => {
    if (/^(?:https?:)?\/\//i.test(href)) return m;
    if (/^data:/i.test(href)) return m;
    const clean = href.split(/[?#]/)[0];
    const key = clean.startsWith("./") ? clean.slice(2) : clean;
    return files[key] != null ? `<style>\n${files[key]}\n</style>` : m;
  });

  html = html.replace(/<script\b([^>]*)src=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi, (m, pre, _q, srcAttr) => {
    if (/^(?:https?:)?\/\//i.test(srcAttr)) return m;
    if (/^data:/i.test(srcAttr)) return m;
    const clean = srcAttr.split(/[?#]/)[0];
    const key = clean.startsWith("./") ? clean.slice(2) : clean;
    return files[key] != null ? `<script${pre}>\n${files[key]}\n</script>` : m;
  });

  if (!/<base\b/i.test(html)) {
    html = html.replace(
      /<head([^>]*)>/i,
      `<head$1>\n<base href="/p/${id}/">`
    );
  }
  return html;
}

/* ----------------------------- gif capture ----------------------------- */

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;
const CAPTURE_FPS = 8;
const CAPTURE_SECONDS = 1.5;
const GIF_WIDTH = 320;

// Injected into the <head> of a dedicated capture iframe so it wraps
// requestAnimationFrame BEFORE the theme registers its own callbacks.
// The wrapper runs the theme's frame first (same task, before composite),
// which lets us read WebGL drawing buffers that lack preserveDrawingBuffer.
const CAPTURE_BOOTSTRAP = `
(function () {
  if (window.__wwCapInstalled) return;
  window.__wwCapInstalled = true;
  var fps = __WW_FPS__, seconds = __WW_SECONDS__, frames = [], startedAt = 0, lastAt = 0, active = false, sampler = null;
  var origRaf = window.requestAnimationFrame;
  function needs() { return Math.max(1, Math.ceil(seconds * fps)); }
  function sample() {
    if (Date.now() - lastAt < 1000 / fps) return;
    lastAt = Date.now();
    var c = document.querySelector('canvas');
    var has = false;
    if (c) {
      try { frames.push(c.toDataURL('image/png')); has = true; } catch (e) {}
    }
    try { parent.postMessage({ __ww: 'frame', got: frames.length, needs: needs(), hasCanvas: has }, '*'); } catch (e) {}
  }
  window.requestAnimationFrame = function (cb) {
    return origRaf.call(window, function (t) {
      try { cb(t); } catch (e) {}
      if (!active) return;
      if (startedAt === 0) startedAt = t;
      sample();
      if (t - startedAt >= seconds * 1000) finish();
    });
  };
  function finish() {
    active = false;
    if (sampler) { clearInterval(sampler); sampler = null; }
    try { parent.postMessage({ __ww: 'done', frames: frames.slice() }, '*'); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.__ww !== 'start') return;
    frames = []; startedAt = 0; lastAt = 0; active = true;
    if (sampler) { clearInterval(sampler); sampler = null; }
    sampler = setInterval(function () { if (active) sample(); }, 1000 / fps);
    window.setTimeout(function () { if (active) finish(); }, seconds * 1000 + 500);
  });
})();
`;

function buildCapturePreviewHtml(files: Record<string, string>, id: string): string {
  let html = buildPreviewHtml(files, id);
  if (!/<head\b/i.test(html)) {
    html = html.replace(/<html([^>]*)>/i, "<html$1>\n<head></head>");
  }
  const bootstrap = CAPTURE_BOOTSTRAP.replace(/__WW_FPS__/g, String(CAPTURE_FPS)).replace(
    /__WW_SECONDS__/g,
    String(CAPTURE_SECONDS)
  );
  return html.replace(/<head([^>]*)>/i, "<head$1>\n<script>" + bootstrap + "</" + "script>");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode frame"));
    img.src = dataUrl;
  });
}

async function downscaleFrame(dataUrl: string, width: number): Promise<string> {
  const img = await loadImage(dataUrl);
  const height = Math.max(1, Math.round((img.height / img.width) * width) || Math.round((width * 5) / 8));
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return cv.toDataURL("image/png");
}

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  activeFileName: string;
};

function EditorFallback({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      className="editor-fallback"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

function CodeEditorHost({
  codeEditor: Comp,
  value,
  onChange,
  activeFileName,
}: CodeEditorProps & { codeEditor: ComponentType<CodeEditorProps> }) {
  return <Comp value={value} onChange={onChange} activeFileName={activeFileName} />;
}

export default function Editor({ id }: { id: string }) {
  const router = useRouter();
  const [meta, setMeta] = useState<ThemeMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeName, setActiveName] = useState("index.html");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [previewKey, setPreviewKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [capturePhase, setCapturePhase] = useState<"recording" | "saving" | null>(null);
  const [captureHtml, setCaptureHtml] = useState<string | null>(null);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureNeeds, setCaptureNeeds] = useState(0);
  const captureIframeRef = useRef<HTMLIFrameElement>(null);
  const captureActiveRef = useRef(false);
  const captureStartSentRef = useRef(false);
  const captureTimeoutRef = useRef<number>(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishErr, setPublishErr] = useState("");
  const [publishDone, setPublishDone] = useState<Record<string, string> | null>(null);
  const [pubTags, setPubTags] = useState("");
  const [pubDonationUrl, setPubDonationUrl] = useState("");
  const [pubDonationLabel, setPubDonationLabel] = useState("");

  const [codeEditor, setCodeEditor] = useState<ComponentType<CodeEditorProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const timeout = new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("CodeMirror 6 load timed out after 10s")), 10000)
        );
        const [mod] = await Promise.race([
          Promise.all([
            import("./CodeEditor"),
            import("@uiw/codemirror-theme-dracula"),
            import("@codemirror/lang-html"),
            import("@codemirror/lang-css"),
            import("@codemirror/lang-javascript"),
            import("@codemirror/lang-json"),
          ]),
          timeout,
        ]);
        if (cancelled) return;
        const Comp = (mod as unknown as { default?: ComponentType<CodeEditorProps> }).default;
        if (!Comp) throw new Error("CodeMirror 6 module has no default export");
        setCodeEditor(() => Comp);
      } catch (e) {
        console.error("CodeMirror 6 unusable, using textarea fallback", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filesRef = useRef(files);
  const activeRef = useRef(activeName);
  const metaRef = useRef(meta);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    filesRef.current = files;
  });
  useEffect(() => {
    metaRef.current = meta;
  });
  useEffect(() => {
    activeRef.current = activeName;
  });

  const toast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    const t = { msg, kind };
    setToasts((prev) => [...prev, t]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x !== t)), 3200);
  }, []);

  /* ------------------------------ loading ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error("Failed to load project");
        const detail = (await res.json()) as { meta: ThemeMeta };
        if (cancelled) return;
        setMeta(detail.meta);

        const fres = await fetch(`/api/projects/${id}/files`);
        const data = (await fres.json()) as { files: Record<string, string> };
        const f = data.files || {};
        if (!f["index.html"] && detail.meta.type === "video") {
          f["index.html"] = "// video theme\n";
        }
        if (!cancelled) {
          filesRef.current = f;
          setFiles(f);
          const preferred = PREFERRED.filter((p) => f[p] !== undefined);
          setActiveName(preferred[0] ?? Object.keys(f)[0] ?? "index.html");
          setStatus("Ready");
        }
      } catch (e) {
        if (!cancelled) {
          setNotFound(true);
          setStatus(e instanceof Error ? e.message : "Failed to load project");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ------------------------------ preview ------------------------------ */

  const previewHtml =
    meta?.type === "html" ? buildPreviewHtml(files, id) : "";

  function onCodeChange(value: string) {
    filesRef.current[activeRef.current] = value;
    setFiles({ ...filesRef.current });
    setDirty(true);
  }

  /* ------------------------------- actions ------------------------------ */

  function switchFile(name: string) {
    if (name === activeRef.current) return;
    activeRef.current = name;
    setActiveName(name);
  }

  function addFile() {
    const raw = window.prompt("New file name (e.g. util.js, glow.css, scene.frag)");
    if (!raw) return;
    const name = raw.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      toast("Invalid file name", "error");
      return;
    }
    if (filesRef.current[name] !== undefined) {
      toast("File already exists", "error");
      return;
    }
    filesRef.current = { ...filesRef.current, [name]: "" };
    setFiles(filesRef.current);
    setActiveName(name);
    setDirty(true);
  }

  async function removeFile(name: string) {
    if (name === "index.html" || !window.confirm(`Delete ${name}?`)) return;
    await fetch(`/api/projects/${id}/files/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
    const next = { ...filesRef.current };
    delete next[name];
    filesRef.current = next;
    setFiles(next);
    if (activeRef.current === name) {
      setActiveName("index.html");
    }
    setDirty(true);
  }

  async function save() {
    if (!meta) return;
    setSaving(true);
    setStatus("Saving…");
    try {
      const payload = {
        name: meta.name,
        description: meta.description,
        author: meta.author,
        version: meta.version,
        thumbnail: meta.thumbnail,
        entry: meta.entry,
      };
      const [fRes, mRes] = await Promise.all([
        fetch(`/api/projects/${id}/files`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: filesRef.current }),
        }),
        fetch(`/api/projects/${id}/meta`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      ]);
      if (!fRes.ok || !mRes.ok) {
        const data = await mRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Save failed");
      }
      const freshMeta = (await mRes.json()) as ThemeMeta;
      setMeta(freshMeta);
      setDirty(false);
      setStatus("Saved");
      toast("Theme saved");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  function exportZip() {
    const a = document.createElement("a");
    a.href = `/api/projects/${id}/export`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openPublish() {
    setPublishErr("");
    setPublishDone(null);
    setPublishOpen(true);
  }

  async function publishTheme() {
    if (!meta || publishBusy) return;
    setPublishBusy(true);
    setPublishErr("");
    try {
      const res = await fetch("/api/themes/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          tags: pubTags.split(",").map((t) => t.trim()).filter(Boolean),
          donation_url: pubDonationUrl.trim(),
          donation_label: pubDonationLabel.trim(),
        }),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, string>;
      if (res.ok && data.id) {
        setPublishDone(data);
        toast("Published to WebKit Wallpaper");
      } else {
        setPublishErr(data.error || `Publish failed (HTTP ${res.status})`);
      }
    } catch (e) {
      setPublishErr(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishBusy(false);
    }
  }

  async function removeProject() {
    if (!window.confirm(`Delete this theme permanently?`)) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    router.push("/");
  }

  async function replaceVideo(file: File) {
    if (!file.type.startsWith("video/")) {
      toast("Only video files are allowed", "error");
      return;
    }
    setVideoBusy(true);
    setVideoProgress(0);
    let uploaded: VideoUpload | null = null;
    try {
      uploaded = await uploadVideoToStorage(file, setVideoProgress);
      if (uploaded.kind === "blob") {
        const res = await fetch(`/api/projects/${id}/video`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl: uploaded.url }),
          signal: AbortSignal.timeout(15 * 60 * 1000),
        });
        const data = safeParse(await res.text()) as ThemeMeta & { error?: string };
        if (res.ok) {
          setMeta(data);
          setPreviewKey((k) => k + 1);
          setDirty(false);
          toast("Video replaced, preview.gif regenerated");
        } else {
          toast(res.status === 413
            ? "The uploaded video is too large for the server (limit ~4.5 MB)."
            : data?.error || `Replace failed (HTTP ${res.status})`, "error");
        }
        setVideoBusy(false);
        return;
      }

      const form = new FormData();
      form.append("video", uploaded.file);
      if (uploaded.reason) {
        const isLocal =
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1" ||
          window.location.hostname.endsWith(".local");
        if (!isLocal && file.size > MULTIPART_SAFE_LIMIT) {
          setVideoBusy(false);
          toast(`This video (${(file.size / (1024 * 1024)).toFixed(1)} MB) is too large for a direct upload — the server accepts at most ~4.5 MB. ${uploaded.reason}`, "error");
          return;
        }
      }
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${id}/video`);
      xhr.timeout = 15 * 60 * 1000;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setVideoProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setVideoBusy(false);
        const data = safeParse(xhr.responseText) as ThemeMeta & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && data?.id) {
          setMeta(data);
          setPreviewKey((k) => k + 1);
          setDirty(false);
          toast("Video replaced, preview.gif regenerated");
        } else if (xhr.status === 413 && uploaded?.kind === "multipart") {
          toast(`This video (${(file.size / (1024 * 1024)).toFixed(1)} MB) is too large for a direct upload — the server accepts at most ~4.5 MB.${uploaded.reason ? ` ${uploaded.reason}` : ""}`, "error");
        } else {
          toast(data?.error || `Replace failed (HTTP ${xhr.status})`, "error");
        }
      };
      xhr.onerror = () => {
        setVideoBusy(false);
        toast("Replace failed", "error");
      };
      xhr.ontimeout = () => {
        setVideoBusy(false);
        toast("The server is taking too long to process the video.", "error");
      };
      xhr.send(form);
    } catch (e) {
      setVideoBusy(false);
      toast(e instanceof DOMException && e.name === "TimeoutError"
        ? "The server is taking too long to process the video."
        : e instanceof Error ? e.message : "Replace failed", "error");
    }
  }

  /* ---------------------------- gif capture ---------------------------- */

  function finishCapture() {
    window.clearTimeout(captureTimeoutRef.current);
    captureActiveRef.current = false;
    captureStartSentRef.current = false;
    setCaptureHtml(null);
    setCapturePhase(null);
    setCapturing(false);
    setCaptureProgress(0);
    setCaptureNeeds(0);
  }

  function abortCapture() {
    toast("Capture cancelled");
    finishCapture();
  }

  function kickCapture() {
    if (captureStartSentRef.current) return;
    captureStartSentRef.current = true;
    window.clearTimeout(captureTimeoutRef.current);
    captureTimeoutRef.current = window.setTimeout(() => {
      const win = captureIframeRef.current?.contentWindow;
      if (win && captureActiveRef.current) win.postMessage({ __ww: "start" }, "*");
    }, 1000);
  }

  async function startCapture() {
    if (!meta || capturing) return;
    const html = buildCapturePreviewHtml(filesRef.current, id);
    setCaptureState(html);
    window.setTimeout(() => {
      if (captureActiveRef.current) {
        toast("Capture timed out — the theme may not be animating.", "error");
        finishCapture();
      }
    }, 15000);
  }

  function setCaptureState(html: string) {
    captureActiveRef.current = true;
    setCaptureHtml(html);
    setCapturing(true);
    setCapturePhase("recording");
    setCaptureProgress(0);
    setCaptureNeeds(0);
    // fallback in case the iframe's onLoad already fired or never fires
    kickCapture();
  }

  async function saveCapture(frames: string[]) {
    const good = frames.filter((f) => f && f.startsWith("data:image/png"));
    if (good.length < 2) {
      toast(
        "No frames captured — the theme may not render to a canvas, or the canvas cannot be read.",
        "error"
      );
      finishCapture();
      return;
    }
    setCapturePhase("saving");
    try {
      const small: string[] = [];
      for (const f of good) {
        small.push(await downscaleFrame(f, GIF_WIDTH));
      }
      const res = await fetch(`/api/projects/${id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames: small, fps: CAPTURE_FPS }),
        signal: AbortSignal.timeout(120000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Capture failed (HTTP ${res.status})`);
      setMeta((m) => (m ? { ...m, thumbnail: "preview.gif" } : m));
      setPreviewKey((k) => k + 1);
      toast("Preview GIF saved to this project");
      finishCapture();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Capture failed", "error");
      finishCapture();
    }
  }

  useEffect(() => {
    const h = (ev: MessageEvent) => {
      const d = ev.data as
        | { __ww?: string; frames?: string[]; got?: number; needs?: number }
        | null;
      if (!d || d.__ww === undefined || !captureActiveRef.current) return;
      if (d.__ww === "frame") {
        if (typeof d.got === "number") setCaptureProgress(d.got);
        if (typeof d.needs === "number") setCaptureNeeds(d.needs);
        return;
      }
      if (d.__ww === "done") {
        void saveCapture(Array.isArray(d.frames) ? d.frames : []);
      }
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------- keyboard ------------------------------ */

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, meta]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* ------------------------------- render -------------------------------- */

  if (notFound) {
    return (
      <div className="not-found">
        <div style={{ fontSize: 40 }}>🫥</div>
        <div>This project does not exist or was deleted.</div>
        <button className="btn" onClick={() => router.push("/")}>
          ← Back to studio
        </button>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="loader">
        <span className="spin" />
        Loading…
      </div>
    );
  }

  const isVideo = meta.type === "video";
  const tabNames = [...Object.keys(files)].sort((a, b) => {
    const ia = PREFERRED.indexOf(a);
    const ib = PREFERRED.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  const thumbSrc = meta.thumbnail ? `/p/${id}/${meta.thumbnail}` : "";

  return (
    <div className="editor-shell">
      <header className="editor-head">
        <button className="btn btn-ghost" onClick={() => router.push("/")} title="Back to studio">
          ←
        </button>
        {thumbSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb-mini" src={thumbSrc} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        )}
        <span className="proj-name" title={meta.name}>
          {meta.name}
        </span>
        <span className={`badge ${meta.type}`}>{isVideo ? "Video" : "HTML / WebGL"}</span>
        <div className="spacer" />
        <span className="status-pill">{status}</span>
        <button className="btn" onClick={() => setPreviewKey((k) => k + 1)} title="Refresh preview">
          ⟳
        </button>
        <a className="btn" href={`/p/${id}/index.html`} target="_blank" rel="noreferrer" title="Open theme in a new tab">
          ↗
        </a>
        <button className="btn" onClick={removeProject} title="Delete project">
          🗑
        </button>
        <button className="btn" onClick={exportZip} title="Download as .zip for WebWallpaper">
          ⬇ .zip
        </button>
        <button className="btn btn-primary" onClick={openPublish} title="Publish this theme to webkit-wallpaper.web.app">
          Publish ↗
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving || isVideo && false}>
          {saving && <span className="spin" />}
          {dirty ? "Save" : "Saved"}
        </button>
      </header>

      <div className="editor-layout">
        <aside className="meta-panel">
          <h3>Theme manifest (.theme)</h3>
          <div className="field">
            <label>Name</label>
            <input
              value={meta.name}
              onChange={(e) => {
                setMeta({ ...meta, name: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              value={meta.description}
              onChange={(e) => {
                setMeta({ ...meta, description: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label>Author</label>
            <input
              value={meta.author}
              onChange={(e) => {
                setMeta({ ...meta, author: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label>Version</label>
            <input
              value={meta.version}
              style={{ maxWidth: 110 }}
              onChange={(e) => {
                setMeta({ ...meta, version: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label>Entry</label>
            <input
              value={meta.entry}
              onChange={(e) => {
                setMeta({ ...meta, entry: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label>Thumbnail</label>
            <input
              value={meta.thumbnail}
              onChange={(e) => {
                setMeta({ ...meta, thumbnail: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
            Generated file
          </label>
          <textarea className="theme-preview" readOnly value={themeContent(meta)} spellCheck={false} />
        </aside>

        {isVideo ? (
          <section className="video-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="thumb-mini"
              src={thumbSrc}
              alt=""
              style={{ width: 220, height: "auto", borderRadius: 10, border: "1px solid var(--border-2)" }}
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
            {meta.video && (
              // Using key so the preview reloads after a replace
              <video key={previewKey} controls muted loop src={`/p/${id}/${meta.video}`} />
            )}
            <div className="hint">
              This theme simply loops the video below the thumbnail. A <code>preview.gif</code> (≥240px wide) was
              generated from your video and referenced in the <code>.theme</code> file as{" "}
              <code>thumbnail=preview.gif</code>.
            </div>
            {videoBusy && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${videoProgress}%` }} />
              </div>
            )}
            <div>
              <button className="btn" disabled={videoBusy} onClick={() => videoInputRef.current?.click()}>
                {videoBusy ? "Replacing…" : "Replace video"}
              </button>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) replaceVideo(f);
                }}
              />
            </div>
          </section>
        ) : (
          <section className="code-pane">
            <div className="file-tabs">
              {tabNames.map((name) => (
                <button
                  key={name}
                  className={`file-tab ${name === activeName ? "active" : ""} ${
                    dirty && name === activeName ? "dirty" : ""
                  }`}
                  onClick={() => switchFile(name)}
                >
                  <span className="dot" />
                  {name}
                  {name !== "index.html" && (
                    <span
                      className="x"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(name);
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              ))}
              <button className="tabs-add" title="Add file" onClick={addFile}>
                +
              </button>
            </div>
            <div className="editor-host">
              {codeEditor ? (
                <CodeEditorHost
                  codeEditor={codeEditor}
                  value={files[activeName] ?? ""}
                  onChange={onCodeChange}
                  activeFileName={activeName}
                />
              ) : (
                <EditorFallback value={files[activeName] ?? ""} onChange={onCodeChange} />
              )}
            </div>
          </section>
        )}

        <div className="resizer" title="Drag to resize" />

        <section className="preview-pane">
          <div className="preview-toolbar">
            <span>Live preview</span>
            <div className="spacer" />
            {!isVideo && (
              <button
                className="btn btn-sm"
                disabled={capturing}
                onClick={startCapture}
                title={`Records the live preview at ${CAPTURE_WIDTH}×${CAPTURE_HEIGHT} (16:10 laptop frame) as a preview.gif thumbnail`}
              >
                {capturing ? (capturePhase === "saving" ? "Saving…" : "Recording…") : "Capture GIF"}
              </button>
            )}
            <span style={{ fontSize: 11.5 }}>
              {isVideo ? "served from this project's folder" : "updates as you type"}
            </span>
          </div>
          {isVideo ? (
            <iframe className="preview-frame" key={previewKey} src={`/p/${id}/index.html`} title="Live theme preview" />
          ) : (
            <iframe className="preview-frame"  srcDoc={previewHtml} allow="accelerometer *; ambient-light-sensor *; camera *; display-capture *; encrypted-media *; geolocation *; gyroscope *; microphone *; midi *; payment *; serial *; vr *; web-share *; xr-spatial-tracking *" title="Live theme preview" allowFullScreen allowTransparency sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-top-navigation-by-user-activation"/>
          )}
        </section>
      </div>

      {captureHtml && (
        <div className="capture-rig">
          <div className="capture-head">
            <span className="capture-title">
              Recording live preview — {CAPTURE_WIDTH}×{CAPTURE_HEIGHT} (16:10 laptop frame)
            </span>
            {capturePhase === "saving" ? (
              <span className="capture-progress">Assembling GIF…</span>
            ) : (
              <span className="capture-progress">
                {captureNeeds ? `${captureProgress}/${captureNeeds} frames` : "warming up…"}
              </span>
            )}
            <button className="btn btn-sm" onClick={abortCapture}>
              Cancel
            </button>
          </div>
          <div className="cap-scaler">
            <iframe
              className="cap-frame"
              ref={captureIframeRef}
              srcDoc={captureHtml}
              title="Capture preview"
              onLoad={kickCapture}
            />
          </div>
          <div className="capture-hint">
            Tip: themes that animate via <code>requestAnimationFrame</code> capture best. The GIF is saved as{" "}
            <code>preview.gif</code>.
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t, i) => (
          <div key={i} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {publishOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => !publishBusy && setPublishOpen(false)}
        >
          <div
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border-2)",
              borderRadius: 12,
              padding: 20,
              width: 420,
              maxWidth: "92vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px" }}>
              {publishDone ? "Published to WebKit Wallpaper" : "Publish to WebKit Wallpaper"}
            </h3>
            {publishDone ? (
              <div>
                <p style={{ margin: "0 0 12px", color: "var(--muted)" }}>
                  Your theme is live on the gallery at <a href={publishDone.siteUrl} target="_blank" rel="noreferrer">webkit-wallpaper.web.app ↗</a>
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn btn-primary" onClick={() => setPublishOpen(false)}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="field">
                  <label>Tags (comma separated)</label>
                  <input
                    value={pubTags}
                    onChange={(e) => setPubTags(e.target.value)}
                    placeholder="webgl, animated"
                  />
                </div>
                <div className="field">
                  <label>Donation URL</label>
                  <input
                    value={pubDonationUrl}
                    onChange={(e) => setPubDonationUrl(e.target.value)}
                    placeholder="https://ko-fi.com/you"
                  />
                </div>
                <div className="field">
                  <label>Donation label</label>
                  <input
                    value={pubDonationLabel}
                    onChange={(e) => setPubDonationLabel(e.target.value)}
                    placeholder="Support me"
                  />
                </div>
                <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 12px" }}>
                  Publishes <code>wallpaper.zip</code> + <code>preview.gif</code> using your current name,
                  description and author.
                </p>
                {publishErr && (
                  <p style={{ color: "#f87171", fontSize: 13, margin: "0 0 10px" }}>{publishErr}</p>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn" onClick={() => setPublishOpen(false)} disabled={publishBusy}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={publishTheme} disabled={publishBusy}>
                    {publishBusy && <span className="spin" />} Publish
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}