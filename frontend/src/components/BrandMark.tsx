type BrandMarkProps = {
  size?: number;
  variant?: "tile" | "glyph";
};

export function BrandMark({ size = 34, variant = "tile" }: BrandMarkProps) {
  if (variant === "glyph") {
    return (
      <svg
        aria-hidden="true"
        className="brand-mark-svg"
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
      >
        <g fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M11.5 7.5h17L20 13Z" />
          <path d="M32.5 11.5v17L27 20Z" />
          <path d="M28.5 32.5h-17L20 27Z" />
          <path d="M7.5 28.5v-17L13 20Z" />
        </g>
        <circle cx="34" cy="34" r="2.4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="brand-mark-svg"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
    >
      <rect width="40" height="40" rx="11" fill="currentColor" />
      <path
        d="M10.5 17.5 20 12l9.5 5.5v10L20 33l-9.5-5.5v-10Z"
        stroke="white"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m10.5 17.5 9.5 5.6 9.5-5.6M20 23.1V33" stroke="white" strokeWidth="2" />
      <path
        d="M18 18.5 25.5 11m-4.5 0h4.5v4.5"
        stroke="#FF6B3D"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
