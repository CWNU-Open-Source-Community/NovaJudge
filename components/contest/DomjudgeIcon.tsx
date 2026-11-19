import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";

export default function DomjudgeIcon({ icon }: { icon: IconDefinition }) {
  const [width, height, , , path] = icon.icon;
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`}
      width={`${width / height}em`} height="1em" fill="currentColor">
      {typeof path === "string" ? <path d={path} /> : path.map(d => <path key={d} d={d} />)}
    </svg>
  );
}
