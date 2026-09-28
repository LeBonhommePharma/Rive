import type { CSSProperties } from "react";

type Props = {
  shortName: string;
  color: string;
  textColor: string;
  title?: string;
  on?: boolean;
  onClick?: () => void;
};

export function LineChip({ shortName, color, textColor, title, on, onClick }: Props) {
  const style: CSSProperties = { background: color, color: textColor };
  const className = `rive-chip${on ? " on" : ""}`;
  if (onClick) {
    return (
      <button type="button" className={className} style={style} title={title || shortName} onClick={onClick}>
        {shortName}
      </button>
    );
  }
  return (
    <span className={className} style={style} title={title || shortName}>
      {shortName}
    </span>
  );
}
