"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Project = {
  id: string;
  type: "html" | "video";
  name: string;
  description: string;
  author: string;
  version: string;
  thumbnail: string;
  entry: string;
  video: string | null;
  preview: string;
  updatedAt: string;
};

type CreateType = "html" | "video";

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);

  const [type, setType] = useState<CreateType>("html");
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0");
  const [videoName, setVideoName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [modalError, setModalError] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<File | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to load projects");
      setProjects((await res.json()) as Project[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = (await res.json()) as Project[];
          if (!cancelled) setProjects(data);
        } else if (!cancelled) {
          setError("Failed to load projects");
        }
      } catch {
        if (!cancelled) setError("Failed to load projects");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openModal() {
    setShowModal(true);
    setType("html");
    setVideoName("");
    videoFileRef.current = null;
    setModalError("");
    setProgress(0);
    setPhase("");
  }

  function closeModal() {
    if (uploading) return;
    setShowModal(false);
  }

  async function createHtml() {
    const n = name.trim();
    if (!n) {
      setModalError("Give your theme a name.");
      return;
    }
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, author, description, version }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      router.push(`/editor/${data.id}`);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Create failed");
    }
  }

  function createVideo() {
    const n = name.trim();
    if (!n) {
      setModalError("Give your theme a name.");
      return;
    }
    if (!videoName) {
      setModalError("Please choose a video file to upload.");
      return;
    }

    const form = new FormData();
    form.append("name", n);
    form.append("author", author);
    form.append("description", description);
    form.append("version", version);
    const file = videoFileRef.current;
    if (!file) {
      setModalError("Please choose a video file to upload.");
      return;
    }
    form.append("video", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/projects/video");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) {
        setPhase("");
        setUploading(false);
        router.push(`/editor/${data.id}`);
      } else {
        setUploading(false);
        setModalError(data.error || "Upload failed");
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setModalError("Upload failed - is the server running?");
    };
    setPhase("Uploading and generating preview.gif (this can take a moment)…");
    setUploading(true);
    xhr.send(form);
  }

  function pickFile(file: File | null) {
    if (!file) return;
    const type = file.type || "";
    if (!type.startsWith("video/")) {
      setModalError("Only video files are allowed.");
      return;
    }
    videoFileRef.current = file;
    setVideoName(file.name);
    setModalError("");
  }

  async function removeProject(p: Project) {
    if (!window.confirm(`Delete "${p.name}"? This removes the theme folder and its files.`)) return;
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <header className="topbar">
        <div className="brand" onClick={() => router.push("/")}>
          <div className="logo">W</div>
          <div>
            <div className="title">WebWallpaper Theme Studio</div>
            <div className="sub">create HTML5 and video wallpapers</div>
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={openModal}>
          <span className="icon">+</span> New project
        </button>
      </header>

      <main className="page">
        <div className="page-head">
          <div>
            <h1>Your themes</h1>
            <p>Built themes are exported as a folder or .zip and can be imported straight into WebWallpaper.</p>
          </div>
        </div>

        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {projects === null ? (
          <div className="projects-grid">
            <div className="empty-state">Loading projects…</div>
          </div>
        ) : projects.length === 0 ? (
          <div className="projects-grid">
            <div className="empty-state">
              <div className="big">🖼️</div>
              <div>No themes yet. Create your first wallpaper.</div>
              <button className="btn btn-primary" onClick={openModal}>
                <span className="icon">+</span> Create a project
              </button>
            </div>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((p) => (
              <div key={p.id} className="project-card">
                <div className="thumb">
                  {p.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.preview} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
                  ) : (
                    <div className="empty">{p.name.charAt(0).toUpperCase()}</div>
                  )}
                  <span className={`badge ${p.type}`}>{p.type === "html" ? "HTML / WebGL" : "Video"}</span>
                </div>
                <div className="body">
                  <div className="name" title={p.name}>
                    {p.name}
                  </div>
                  <div className="desc">{p.description || "No description"}</div>
                  <div className="meta-row">
                    <span>{p.author || "Unknown author"} · v{p.version}</span>
                    <span style={{ marginLeft: "auto" }}>{fmtDate(p.updatedAt)}</span>
                  </div>
                </div>
                <div className="actions">
                  <button className="btn btn-primary" onClick={() => router.push(`/editor/${p.id}`)}>
                    Open
                  </button>
                  <button className="btn" onClick={() => triggerDownload(`/api/projects/${p.id}/export`)}>
                    Export .zip
                  </button>
                  <button className="btn btn-danger btn-sm" title="Delete project" onClick={() => removeProject(p)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showModal && (
        <div className="overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-x" onClick={closeModal}>
              ✕
            </button>
            <h2>New theme project</h2>
            <p className="modal-sub">First, choose what kind of wallpaper you want to build.</p>

            <div className="type-cards">
              <button className={`type-card ${type === "html" ? "active" : ""}`} onClick={() => setType("html")}>
                <span className="tc-title">
                  <span className="tc-ico">⌨️</span> HTML5 + JS + WebGL
                </span>
                <span className="tc-desc">Full code editor with a live preview. Write HTML, CSS and WebGL shaders.</span>
              </button>
              <button className={`type-card ${type === "video" ? "active" : ""}`} onClick={() => setType("video")}>
                <span className="tc-title">
                  <span className="tc-ico">🎞️</span> Video only
                </span>
                <span className="tc-desc">Upload a looping video. A preview.gif thumbnail is generated for you.</span>
              </button>
            </div>

            <div className="field">
              <label>Theme name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Wallpaper"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Author</label>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this wallpaper about?"
              />
            </div>
            <div className="field">
              <label>Version</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)} style={{ maxWidth: 120 }} />
            </div>

            {type === "video" && (
              <>
                <div
                  className={`dropzone ${drag ? "drag" : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    pickFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  {videoName ? (
                    <>
                      <div className="dz-main">Ready to upload</div>
                      <div className="dz-file">{videoName}</div>
                    </>
                  ) : (
                    <>
                      <div className="dz-main">Drop a video here or click to browse</div>
                      <div>mp4, webm, mov… (a preview.gif will be generated at 240px wide)</div>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  style={{ display: "none" }}
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                {uploading && (
                  <>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{phase}</div>
                  </>
                )}
              </>
            )}

            {modalError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{modalError}</p>}

            <div className="form-actions">
              <button className="btn" onClick={closeModal} disabled={uploading}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={uploading}
                onClick={() => (type === "html" ? createHtml() : createVideo())}
              >
                {uploading && <span className="spin" />}
                {uploading ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}