import type { OnlineAuthProvider, OnlineAuthSession } from "../domain/onlineAuth";

type Props = {
  config?: unknown;
  session: OnlineAuthSession | null;
  loadingAuth: boolean;
  error?: string;
  onSignIn: (provider?: OnlineAuthProvider) => void;
  onSignOut: () => void;
};

export function AdminPage({ error, onSignIn }: Props) {
  return (
    <main className="admin-shell">
      <section className="admin-empty-state">
        <p className="eyebrow">Local build</p>
        <h1>Hosted admin is not included.</h1>
        <p>The public ICC-GO build is local-first and does not include hosted OAuth, telemetry, or admin infrastructure.</p>
        {error && <p className="admin-error">{error}</p>}
        <button type="button" onClick={() => onSignIn()} disabled>
          Hosted sign-in unavailable
        </button>
      </section>
    </main>
  );
}
