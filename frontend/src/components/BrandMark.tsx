type BrandMarkProps = {
  size?: number;
};

export function BrandMark({ size = 34 }: BrandMarkProps) {
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
