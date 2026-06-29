import { ICC_GO_VERSION_LABEL } from "../version";

interface AppLogoProps {
  className?: string;
  onClick?: () => void;
  subtitle?: string;
}

export function AppLogo({ className = "", onClick, subtitle = `Beta · ${ICC_GO_VERSION_LABEL}` }: AppLogoProps) {
  const classes = ["app-logo", className].filter(Boolean).join(" ");
  const label = subtitle ? `ICC-GO ${subtitle}` : "ICC-GO";
  const content = (
    <>
      <img alt="" aria-hidden="true" src="/brand/icc-go-logo-18.png" />
      <span className="app-logo-copy">
        <strong>ICC-GO</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button aria-label="Back to notebook" className={classes} onClick={onClick} title="Back to notebook" type="button">
        {content}
      </button>
    );
  }

  return (
    <div aria-label={label} className={classes}>
      {content}
    </div>
  );
}
