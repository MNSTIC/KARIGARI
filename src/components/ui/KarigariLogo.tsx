import React from 'react';

interface KarigariLogoProps {
  size?: number;
  showWordmark?: boolean;
  variant?: 'dark' | 'light';
  className?: string;
}

export function KarigariLogo({ size = 32, showWordmark = false, variant = 'dark', className = '' }: KarigariLogoProps) {
  const color = variant === 'dark' ? '#1A1A1A' : '#F6F3EE';
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 100 100" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <rect x="35" y="25" width="20" height="50" rx="2" fill={color} />
        <rect x="32" y="20" width="26" height="5" rx="1" fill={color} />
        <rect x="32" y="75" width="26" height="5" rx="1" fill={color} />
        <line x1="35" y1="35" x2="55" y2="30" stroke={variant === 'dark' ? '#F6F3EE' : '#1A1A1A'} strokeWidth="1.5" />
        <line x1="35" y1="45" x2="55" y2="40" stroke={variant === 'dark' ? '#F6F3EE' : '#1A1A1A'} strokeWidth="1.5" />
        <line x1="35" y1="55" x2="55" y2="50" stroke={variant === 'dark' ? '#F6F3EE' : '#1A1A1A'} strokeWidth="1.5" />
        <line x1="35" y1="65" x2="55" y2="60" stroke={variant === 'dark' ? '#F6F3EE' : '#1A1A1A'} strokeWidth="1.5" />
        <path d="M52 50 L85 20 M55 50 L95 20 M50 50 L85 80 M52 50 L95 80" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <path d="M25 25 L35 45" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="24" r="1.5" fill={variant === 'dark' ? '#F6F3EE' : '#1A1A1A'} />
        <path d="M35 45 C45 65, 10 50, 20 75" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
      {/* Sentence case, matching the rail and every other surface. The
          uppercase, letter-spaced wordmark belonged to the old theme. */}
      {showWordmark && (
        <span className="kg-display text-[21px] leading-none" style={{ color }}>
          Karigari
        </span>
      )}
    </div>
  );
}
