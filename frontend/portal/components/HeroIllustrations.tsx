export function ShieldCheckIllustration({ className }: { className?: string }) {
  return (
    <svg width="72" height="80" viewBox="0 0 72 80" fill="none" className={className}>
      <path
        d="M36 2 L68 14 V38 C68 58 54 72 36 78 C18 72 4 58 4 38 V14 Z"
        fill="var(--primary-soft)"
        stroke="var(--primary)"
        strokeWidth="2"
      />
      <path d="M22 40 L32 50 L50 28" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocumentIllustration({ className }: { className?: string }) {
  return (
    <svg width="58" height="72" viewBox="0 0 58 72" fill="none" className={className}>
      <rect x="3" y="3" width="52" height="66" rx="6" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
      <line x1="13" y1="20" x2="45" y2="20" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <line x1="13" y1="30" x2="45" y2="30" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
      <line x1="13" y1="40" x2="35" y2="40" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="45" cy="55" r="9" fill="var(--status-good-bg)" stroke="var(--status-good-fg)" strokeWidth="2" />
      <path d="M41 55 L44 58 L50 51" stroke="var(--status-good-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IdCardIllustration({ className }: { className?: string }) {
  return (
    <svg width="76" height="66" viewBox="0 0 76 66" fill="none" className={className}>
      <rect x="3" y="3" width="70" height="60" rx="8" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2" />
      <circle cx="22" cy="26" r="10" fill="var(--primary-soft)" stroke="var(--primary)" strokeWidth="2" />
      <path d="M11 50 C11 40 33 40 33 50" fill="var(--primary-soft)" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
      <line x1="44" y1="19" x2="65" y2="19" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="44" y1="28" x2="65" y2="28" stroke="var(--border)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="44" y1="37" x2="58" y2="37" stroke="var(--border)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
