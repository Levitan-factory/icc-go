import {
  getLanguageWikiAlphabeticalIndex,
  getLanguageWikiEntriesByGroup,
  getPlannedLanguageWikiEntries,
  getSupportedLanguageWikiEntries,
  languageWiki,
  languageWikiEntrySortKey,
  type LanguageWikiEntry,
} from "../docs/wiki/languageWiki";

interface DslCatalogViewProps {
  mode: "catalog" | "index";
}

export function DslCatalogView({ mode }: DslCatalogViewProps) {
  const supportedCount = getSupportedLanguageWikiEntries().length;
  const plannedCount = getPlannedLanguageWikiEntries().length;
  const alphabeticalEntries = getLanguageWikiAlphabeticalIndex();

  return (
    <div className="dsl-wiki">
      <section className="dsl-wiki-intro" aria-label="DSL catalog summary">
        <div>
          <p className="eyebrow">Generated Catalog</p>
          <h2>{mode === "index" ? "Alphabetical ICC Index" : "ICC DSL Wiki"}</h2>
          <p>
            This wiki is generated from the latest language catalog. Add a language feature to a versioned
            `src/language/vX_Y` package with parser support and tests; the docs navigation, groups, and A-Z
            index update automatically.
          </p>
        </div>
        <dl>
          <div>
            <dt>Language</dt>
            <dd>{languageWiki.languageVersion}</dd>
          </div>
          <div>
            <dt>Supported</dt>
            <dd>{supportedCount}</dd>
          </div>
          <div>
            <dt>Planned</dt>
            <dd>{plannedCount}</dd>
          </div>
        </dl>
      </section>

      <AlphabeticalIndex entries={alphabeticalEntries} />

      {mode === "index" ? (
        <CatalogEntryList entries={alphabeticalEntries} title="A-Z Entries" />
      ) : (
        <div className="dsl-group-stack">
          {languageWiki.groups.map((group) => {
            const entries = getLanguageWikiEntriesByGroup(group.id);
            if (!entries.length) return null;

            return (
              <section className="dsl-group" id={`dsl-group-${group.id}`} key={group.id}>
                <div className="dsl-group-heading">
                  <div>
                    <p className="eyebrow">{entries.length} entries</p>
                    <h2>{group.title}</h2>
                    <p>{group.description}</p>
                  </div>
                </div>
                <div className="dsl-entry-grid">
                  {[...entries]
                    .sort((left, right) => languageWikiEntrySortKey(left).localeCompare(languageWikiEntrySortKey(right)))
                    .map((entry) => <CatalogEntryCard entry={entry} key={entry.id} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlphabeticalIndex({ entries }: { entries: LanguageWikiEntry[] }) {
  return (
    <section className="dsl-alpha-index" aria-label="Alphabetical index">
      <div>
        <p className="eyebrow">A-Z Index</p>
        <h2>Operators, Functions, References</h2>
      </div>
      <div className="dsl-alpha-links">
        {entries.map((entry) => (
          <a href={`#dsl-${entry.id}`} key={entry.id}>
            <code>{entry.symbol}</code>
            <span>{entry.name}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function CatalogEntryList({ entries, title }: { entries: LanguageWikiEntry[]; title: string }) {
  return (
    <section className="dsl-group">
      <div className="dsl-group-heading">
        <div>
          <p className="eyebrow">{entries.length} entries</p>
          <h2>{title}</h2>
          <p>Every supported and planned language item sorted by display name.</p>
        </div>
      </div>
      <div className="dsl-entry-grid">
        {entries.map((entry) => <CatalogEntryCard entry={entry} key={entry.id} />)}
      </div>
    </section>
  );
}

function CatalogEntryCard({ entry }: { entry: LanguageWikiEntry }) {
  return (
    <article className={`dsl-entry-card ${entry.status}`} id={`dsl-${entry.id}`}>
      <header>
        <span className="dsl-entry-symbol">{entry.symbol}</span>
        <div>
          <div className="dsl-entry-title-row">
            <h3>{entry.name}</h3>
            <span className={`dsl-entry-status ${entry.status}`}>{entry.status}</span>
          </div>
          <p>{entry.summary}</p>
        </div>
      </header>

      <div className="dsl-entry-section">
        <h4>Syntax</h4>
        <div className="dsl-syntax-list">
          {entry.syntax.map((syntax) => <code key={syntax}>{syntax}</code>)}
        </div>
      </div>

      {entry.examples.length ? (
        <div className="dsl-entry-section">
          <h4>Examples</h4>
          {entry.examples.map((example) => (
            <div className="dsl-example" key={`${entry.id}-${example.label}`}>
              <span>{example.label}</span>
              <pre><code>{example.code}</code></pre>
            </div>
          ))}
        </div>
      ) : null}

      {entry.notes.length ? (
        <div className="dsl-entry-section">
          <h4>Notes</h4>
          <ul>
            {entry.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      ) : null}

      <footer>
        <span>Since {entry.since}</span>
        <span>{entry.source}</span>
        {entry.parserCoverage ? <span>Coverage: {entry.parserCoverage}</span> : null}
      </footer>
    </article>
  );
}
