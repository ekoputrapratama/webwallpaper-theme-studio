"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadVideoToStorage, type VideoUpload } from "@/lib/client-upload";

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

type CodeMirrorHandle = {
  getValue(): string;
  setValue(v: string): void;
  setOption(key: string, val: unknown): void;
  on(type: string, cb: (...a: unknown[]) => void): void;
  refresh(): void;
  toTextArea(): void;
  getWrapperElement(): HTMLElement;
};

type CodeMirrorCtor = (el: HTMLDivElement, opts: Record<string, unknown>) => CodeMirrorHandle;

type Toast = { msg: string; kind: "ok" | "error" };

const CM_BASE = "https://unpkg.com/codemirror@5.65.16";
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

function modeFor(name: string): string | null {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return "text/html";
    case ".css":
      return "text/css";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".json":
      return "application/json";
    case ".svg":
    case ".xml":
      return "application/xml";
    default:
      return null;
  }
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

function loadCodeMirror(): Promise<"cm" | "text"> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).CodeMirror) {
      resolve("cm");
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${CM_BASE}/lib/codemirror.css`;
    const theme = document.createElement("link");
    theme.rel = "stylesheet";
    theme.href = `${CM_BASE}/theme/dracula.css`;
    document.head.append(link, theme);

    const scripts = [
      `${CM_BASE}/lib/codemirror.js`,
      `${CM_BASE}/addon/edit/closebrackets.js`,
      `${CM_BASE}/mode/xml/xml.js`,
      `${CM_BASE}/mode/javascript/javascript.js`,
      `${CM_BASE}/mode/css/css.js`,
      `${CM_BASE}/mode/htmlmixed/htmlmixed.js`,
    ];
    let remaining = scripts.length;
    const done = () => {
      if (--remaining !== 0) return;
      setTimeout(() => {
        const has = typeof (window as unknown as Record<string, unknown>).CodeMirror !== "undefined";
        resolve(has ? "cm" : "text");
      }, 0);
    };
    for (const src of scripts) {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = done;
      s.onerror = done;
      document.head.appendChild(s);
    }
  });
}

export default function Editor({ id }: { id: string }) {
  const router = useRouter();
  const [meta, setMeta] = useState<ThemeMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeName, setActiveName] = useState("index.html");
  const [cmAvailable, setCmAvailable] = useState<"loading" | "cm" | "text">("loading");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewKey, setPreviewKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);

  const cmRef = useRef<CodeMirrorHandle | null>(null);
  const cmMountRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const filesRef = useRef(files);
  const activeRef = useRef(activeName);
  const metaRef = useRef(meta);
  const suppressRef = useRef(false);
  const scheduleRef = useRef<number>(0);
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

  /* --------------------------- codemirror load -------------------------- */

  useEffect(() => {
    if (cmAvailable !== "loading") return;
    let live = true;
    loadCodeMirror().then((mode) => {
      if (live) setCmAvailable(mode);
    });
    return () => {
      live = false;
    };
  }, [cmAvailable]);

  /* ------------------------------ preview ------------------------------- */

  const buildPreview = useCallback(() => {
    setPreviewHtml(buildPreviewHtml(filesRef.current, id));
  }, [id]);

  useEffect(() => {
    if (meta?.type === "html") buildPreview();
  }, [meta?.type, buildPreview]);

  const schedulePreview = useCallback(() => {
    window.clearTimeout(scheduleRef.current);
    scheduleRef.current = window.setTimeout(() => setPreviewHtml(buildPreviewHtml(filesRef.current, id)), 300);
  }, [id]);

  const handleChange = useCallback(() => {
    if (suppressRef.current) return;
    const cm = cmRef.current;
    if (!cm) return;
    const v = cm.getValue();
    filesRef.current[activeRef.current] = v;
    setFiles({ ...filesRef.current });
    setDirty(true);
    schedulePreview();
  }, [schedulePreview]);

  useEffect(() => {
    if (cmAvailable !== "cm" || !cmMountRef.current) return;
    const CodeMirrorGlobal = (window as unknown as { CodeMirror?: CodeMirrorCtor }).CodeMirror;
    if (!CodeMirrorGlobal) return;
    const cm = CodeMirrorGlobal(cmMountRef.current, {
      value: filesRef.current[activeRef.current] ?? "",
      mode: modeFor(activeRef.current) ?? null,
      theme: "dracula",
      lineNumbers: true,
      autoCloseBrackets: true,
      lineWrapping: true,
      tabSize: 2,
    });
    cm.on("change", handleChange);
    cm.refresh();
    cmRef.current = cm;
    return () => {
      cmRef.current = null;
      cm.getWrapperElement().remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmAvailable]);

  useEffect(() => {
    if (cmAvailable !== "cm" || !cmRef.current) return;
    const v = files[activeName] ?? "";
    if (cmRef.current.getValue() !== v) {
      suppressRef.current = true;
      cmRef.current.setValue(v);
      suppressRef.current = false;
      cmRef.current.setOption("mode", modeFor(activeName) ?? null);
      cmRef.current.refresh();
    }
  }, [files, activeName, cmAvailable]);

  function onFallbackChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    filesRef.current[activeRef.current] = e.target.value;
    setFiles({ ...filesRef.current });
    setDirty(true);
    schedulePreview();
  }

  /* ------------------------------- actions ------------------------------ */

  function switchFile(name: string) {
    if (name === activeRef.current) return;
    if (cmRef.current && cmAvailable === "cm") {
      filesRef.current[activeRef.current] = cmRef.current.getValue();
    }
    activeRef.current = name;
    setFiles({ ...filesRef.current });
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
    if (cmRef.current && cmAvailable === "cm") {
      filesRef.current[activeRef.current] = cmRef.current.getValue();
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

  useEffect(
    () => () => window.clearTimeout(scheduleRef.current),
    []
  );

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
    <>
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
              {cmAvailable === "cm" ? (
                <div ref={cmMountRef} style={{ height: "100%" }} />
              ) : cmAvailable === "text" ? (
                <textarea
                  ref={taRef}
                  className="editor-fallback"
                  value={files[activeName] ?? ""}
                  onChange={onFallbackChange}
                  spellCheck={false}
                />
              ) : (
                <div className="editor-fallback" style={{ color: "var(--muted)" }}>
                  Loading editor…
                </div>
              )}
            </div>
          </section>
        )}

        <div className="resizer" title="Drag to resize" />

        <section className="preview-pane">
          <div className="preview-toolbar">
            <span>Live preview</span>
            <div className="spacer" />
            <span style={{ fontSize: 11.5 }}>
              {isVideo ? "served from this project's folder" : "updates as you type"}
            </span>
          </div>
          {isVideo ? (
            <iframe className="preview-frame" key={previewKey} src={`/p/${id}/index.html`} title="Live theme preview" />
          ) : (
            <iframe className="preview-frame" srcDoc={previewHtml} title="Live theme preview" />
          )}
        </section>
      </div>

      <div className="toasts">
        {toasts.map((t, i) => (
          <div key={i} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}