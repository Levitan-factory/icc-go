import { BookOpen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  defaultDocumentationPageId,
  documentationPages,
  documentationSections,
  findDocumentationPage,
  type DocumentationSection,
} from "../domain/docs";
import { AppLogo } from "./AppLogo";
import { DslCatalogView } from "./DslCatalogView";
import { MarkdownView } from "./MarkdownView";

interface DocsPageProps {
  open: boolean;
  onClose: () => void;
}

export function DocsPage({ open, onClose }: DocsPageProps) {
  const [activePageId, setActivePageId] = useState(() => getHashPageId());
  const activePage = findDocumentationPage(activePageId);
  const groupedPages = useMemo(
    () =>
      documentationSections.map((section) => ({
        section,
        pages: documentationPages.filter((page) => page.section === section),
      })),
    [],
  );

  useEffect(() => {
    if (!open) return;

    const pageId = getHashPageId();
    setActivePageId(findDocumentationPage(pageId).id);

    function handleHashChange() {
      setActivePageId(findDocumentationPage(getHashPageId()).id);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  function openPage(pageId: string) {
    setActivePageId(pageId);
    window.history.replaceState(null, "", `/docs#${pageId}`);
  }

  return (
    <section className="docs-backdrop is-open" aria-label="Documentation" aria-modal="true" role="dialog">
      <div className="docs-screen">
        <header className="docs-page-header">
          <div className="docs-header-copy">
            <AppLogo className="docs-logo" />
            <div>
              <p className="eyebrow">Documentation</p>
              <h2>ICC-GO Docs</h2>
              <p>Articles, language reference, workspace controls, and copyable examples.</p>
            </div>
          </div>
          <button className="docs-close-button" type="button" onClick={onClose} aria-label="Close documentation">
            <X size={20} />
          </button>
        </header>

        <div className="docs-layout">
          <aside className="docs-nav" aria-label="Documentation sections">
            {groupedPages.map(({ section, pages }) => (
              <DocsNavGroup
                key={section}
                activePageId={activePage.id}
                pages={pages}
                section={section}
                onOpenPage={openPage}
              />
            ))}
          </aside>

          <main className="docs-main">
            <article className="docs-article">
              <div className="docs-article-heading">
                <BookOpen size={20} />
                <div>
                  <p className="eyebrow">{activePage.section}</p>
                  <h1>{activePage.title}</h1>
                  <p>{activePage.description}</p>
                </div>
              </div>
              {activePage.kind === "dsl-catalog" ? <DslCatalogView mode="catalog" /> : null}
              {activePage.kind === "dsl-index" ? <DslCatalogView mode="index" /> : null}
              {activePage.kind === "markdown" ? <MarkdownView markdown={activePage.content ?? ""} /> : null}
            </article>
          </main>
        </div>
      </div>
    </section>
  );
}

function DocsNavGroup({
  activePageId,
  pages,
  section,
  onOpenPage,
}: {
  activePageId: string;
  pages: typeof documentationPages;
  section: DocumentationSection;
  onOpenPage: (pageId: string) => void;
}) {
  return (
    <div className="docs-nav-group">
      <h3>{section}</h3>
      {pages.map((page) => (
        <button
          className={page.id === activePageId ? "is-active" : ""}
          key={page.id}
          type="button"
          onClick={() => onOpenPage(page.id)}
        >
          <span>{page.title}</span>
          <small>{page.description}</small>
        </button>
      ))}
    </div>
  );
}

function getHashPageId(): string {
  return window.location.hash.replace(/^#/, "") || defaultDocumentationPageId;
}
