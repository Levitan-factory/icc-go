import {
  ICC_GO_VERSION_LABEL,
  SUPPORTED_ICC_DSL_CHANNEL,
  SUPPORTED_ICC_DSL_VERSION,
  SUPPORTED_ICC_DSL_VERSION_LABEL,
} from "../version";
import { nowIso } from "../lib/id";
import type { NotebookMetadata } from "./types";

export function createNotebookMetadata(createdAt = nowIso()): NotebookMetadata {
  return {
    dsl_version: SUPPORTED_ICC_DSL_VERSION,
    dsl_version_label: SUPPORTED_ICC_DSL_VERSION_LABEL,
    dsl_channel: SUPPORTED_ICC_DSL_CHANNEL,
    runtime: "icc-go",
    created_with: ICC_GO_VERSION_LABEL,
    created_at: createdAt,
  };
}

export function normalizeNotebookMetadata(
  metadata: Partial<NotebookMetadata> | undefined,
  createdAt = nowIso(),
): NotebookMetadata {
  return {
    ...createNotebookMetadata(createdAt),
    ...metadata,
    runtime: "icc-go",
  };
}
