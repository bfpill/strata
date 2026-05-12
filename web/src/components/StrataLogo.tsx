export function StrataLogo({ size = 44 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      style={{ display: "inline-block", verticalAlign: "middle", marginRight: "0.4rem" }}
    >
      <path d="M15 170 C45 165, 75 168, 100 150 C115 140, 125 125, 130 108" stroke="#bfdbfe" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <path d="M15 140 C40 135, 65 140, 90 125 C110 112, 120 98, 130 108" stroke="#93c5fd" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <path d="M15 110 C35 105, 55 115, 80 100 C100 88, 115 80, 130 108" stroke="#60a5fa" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <path d="M15 80 C30 78, 50 88, 70 75 C90 62, 110 55, 130 108" stroke="#3b82f6" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <path d="M15 50 C28 50, 45 60, 60 52 C80 40, 105 35, 130 108" stroke="#2563eb" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <path d="M15 25 C25 28, 40 35, 55 30 C75 22, 100 20, 130 108" stroke="#1d4ed8" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <circle cx="130" cy="108" r="10" fill="#1e40af"/>
      <circle cx="130" cy="108" r="5" fill="white"/>
    </svg>
  );
}
