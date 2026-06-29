import { Clipboard, Download, FileText, X } from "lucide-react";
import { useEffect } from "react";
import { artifactIcon } from "../domain/runtime";
import type { Artifact } from "../domain/types";

interface ArtifactViewerProps {
  artifact?: Artifact;
  onClose: () => void;
  onUseInPrompt: (artifact: Artifact) => void;
}

export function ArtifactViewer({
  artifact,
  onClose,
  onUseInPrompt,
}: ArtifactViewerProps) {
  useEffect(() => {
    if (!artifact) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [artifact, onClose]);

  if (!artifact) return null;

  const reference = `%file.${artifact.cellAlias}:${artifact.displayName}`;
  const isImageArtifact = artifact.metadata.channel === "image" && artifact.mimeType.startsWith("image/");

  async function copyContent() {
    await navigator.clipboard?.writeText(artifact?.content ?? "");
  }

  async function copyReference() {
    await navigator.clipboard?.writeText(reference);
  }

  return (
    <div
      className="artifact-viewer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="artifact-viewer" role="dialog" aria-modal="true" aria-label={`${artifact.displayName} artifact preview`}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Artifact</p>
            <h2>
              <FileText size={18} />
              {artifactIcon(artifact.extension)} {artifact.displayName}
            </h2>
            <span className="artifact-meta">
              {artifact.mimeType} · v{artifact.version} · {artifact.sizeBytes} bytes
            </span>
          </div>
          <button className="artifact-close-button" type="button" onClick={onClose} aria-label="Close artifact viewer" title="Close artifact viewer">
            <X size={18} />
          </button>
        </div>

        <div className="artifact-actions">
          <button type="button" onClick={copyContent}>
            <Clipboard size={15} />
            {isImageArtifact ? "Copy base64" : "Copy content"}
          </button>
          <button type="button" onClick={copyReference}>
            <Clipboard size={15} />
            Copy reference
          </button>
          <button type="button" onClick={() => onUseInPrompt(artifact)}>
            Use in prompt
          </button>
          <a download={artifact.displayName} href={downloadHref(artifact)}>
            <Download size={15} />
            Download
          </a>
        </div>

        {isImageArtifact ? (
          <div className="artifact-image-preview">
            <img src={imageDataUrl(artifact)} alt={artifact.displayName} />
          </div>
        ) : (
          <pre className={`artifact-preview ${artifact.extension === ".json" ? "json" : ""}`}>
            {formatPreview(artifact)}
          </pre>
        )}
      </aside>
    </div>
  );
}

function formatPreview(artifact: Artifact): string {
  if (artifact.extension !== ".json") return artifact.content;

  try {
    return JSON.stringify(JSON.parse(artifact.content), null, 2);
  } catch {
    return artifact.content;
  }
}

function downloadHref(artifact: Artifact): string {
  if (artifact.metadata.channel === "image" && artifact.mimeType.startsWith("image/")) return imageDataUrl(artifact);
  return URL.createObjectURL(new Blob([artifact.content], { type: artifact.mimeType }));
}

function imageDataUrl(artifact: Artifact): string {
  return `data:${artifact.mimeType};base64,${artifact.content}`;
}
