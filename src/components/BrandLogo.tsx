import React, { useState } from 'react';

interface BrandLogoProps {
  showTagline?: boolean;
  tone?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
}

const HIMRUDRA_LOGO_PATH =
  '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg';

export const BrandLogo: React.FC<BrandLogoProps> = ({
  showTagline = false,
  tone = 'dark',
  size = 'md',
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const textColor = tone === 'light' ? 'text-[#FAF8F4]' : 'text-[#281A15]';
  const subColor = tone === 'light' ? 'text-[#C69B51]' : 'text-[#79543D]';
  const strokePrimary = tone === 'light' ? '#FAF8F4' : '#281A15';
  const dimClass =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const iconSize = size === 'sm' ? 28 : size === 'lg' ? 42 : 34;

  return (
    <span className="inline-flex items-center gap-2.5 shrink-0 select-none">
      {!imgFailed ? (
        <span
          className={`${dimClass} shrink-0 rounded-full overflow-hidden border border-[#C69B51]/70 bg-[#281A15] shadow-xs`}
        >
          <img
            src={HIMRUDRA_LOGO_PATH}
            alt="HimRudra original crest"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover scale-[1.1]"
          />
        </span>
      ) : (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 44 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx="22" cy="22" r="20.5" stroke="#C69B51" strokeWidth="1.2" />
          <path
            d="M7 30L16.5 14.5L22.5 23.5L28 16L37 30H7Z"
            stroke={strokePrimary}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="flex flex-col leading-none">
        <span
          className={`font-serif font-semibold tracking-wide whitespace-nowrap ${
            size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-lg' : 'text-xl'
          } ${textColor}`}
        >
          HimRudra
        </span>
        {showTagline && (
          <span
            className={`text-[10px] tracking-[0.22em] uppercase mt-1 whitespace-nowrap ${subColor}`}
          >
            Pure by Himalayas
          </span>
        )}
      </span>
    </span>
  );
};
