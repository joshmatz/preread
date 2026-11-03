import type { LineCount } from "./line-counts";

// Log scale, so a one-line fix still shows and every rewrite past 500 lines fills it.
const fullAt = 500;

export function ChangeMeter({ plus, minus }: LineCount) {
  const total = plus + minus;
  return (
    <span className="change-meter" aria-hidden="true">
      {total > 0 && (
        <span style={{ width: `${Math.min(1, Math.log1p(total) / Math.log1p(fullAt)) * 100}%` }}>
          {plus > 0 && <i className="added" style={{ flexGrow: plus }} />}
          {minus > 0 && <i className="deleted" style={{ flexGrow: minus }} />}
        </span>
      )}
    </span>
  );
}
