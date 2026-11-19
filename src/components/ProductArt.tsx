import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { motion } from 'motion/react';

export type ProductVisualKind = 'hero' | 'texture' | 'ritual' | 'box' | 'lab';

interface ProductArtProps {
  kind: ProductVisualKind;
  customImageUrl?: string;
  alt?: string;
  className?: string;
  interactiveParallax?: boolean;
  compact?: boolean;
}

export const ProductArt: React.FC<ProductArtProps> = ({
  kind,
  customImageUrl,
  alt = 'HimRudra Himalayan Shilajit Resin 20 g',
  className = '',
  interactiveParallax = false,
  compact = false,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactiveParallax) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: nx * 12, y: -ny * 10 });
  };

  const resetTilt = () => {
    if (interactiveParallax) setTilt({ x: 0, y: 0 });
  };

  if (compact && kind === 'hero' && customImageUrl && !imgFailed) {
    return (
      <div className={`relative w-full h-full bg-black flex items-center justify-center p-1 ${className}`}>
        <img
          src={customImageUrl}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  // Authentic Hero Stage: Exact uploaded 20 g HimRudra Jar on a carved natural stone pedestal
  if (kind === 'hero' && customImageUrl && !imgFailed) {
    return (
      <div
        onMouseMove={handleMouseMove}
        onMouseLeave={resetTilt}
        className={`relative w-full h-full overflow-hidden rounded-2xl bg-gradient-to-b from-[#F3EDE5] via-[#EAE0D2] to-[#DDD0BE] flex flex-col items-center justify-end p-5 sm:p-8 ${className}`}
      >
        {/* Soft Himalayan Mountain Silhouette & Studio Sunlight Backdrop */}
        <svg
          viewBox="0 0 600 600"
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="heroStudioGlow" cx="50%" cy="32%" r="58%">
              <stop offset="0%" stopColor="#FAF8F4" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#C69B51" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#DFD2C0" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="heroMtnBack" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8E7563" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#F3EDE5" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="heroMtnMid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#79543D" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#E6DAC9" stopOpacity="0.06" />
            </linearGradient>
          </defs>
          <rect width="600" height="600" fill="url(#heroStudioGlow)" />
          <path
            d="M-20 330 L90 195 L185 268 L300 148 L415 258 L512 178 L620 305 L620 440 L-20 440 Z"
            fill="url(#heroMtnBack)"
          />
          <path
            d="M-20 380 L118 258 L228 325 L348 228 L468 314 L620 252 L620 480 L-20 480 Z"
            fill="url(#heroMtnMid)"
          />
        </svg>

        {/* Floating Exact 20 g Jar with 3D-inspired Parallax & Gold Studio Rim */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: [0, -6, 0] }}
          transition={{
            opacity: { duration: 0.7 },
            y: { duration: 5.5, repeat: Infinity, ease: 'easeInOut' },
          }}
          style={{
            transform: `perspective(950px) rotateY(${tilt.x * 0.55}deg) rotateX(${tilt.y * 0.45}deg)`,
          }}
          className="relative z-10 w-[76%] max-w-[336px] aspect-[4/4.3] transition-transform duration-200 ease-out"
        >
          {/* Ambient gold studio halo behind arched vitrine */}
          <div
            aria-hidden="true"
            className="absolute -inset-4 rounded-t-full bg-gradient-to-b from-[#C69B51]/35 via-[#C69B51]/12 to-transparent blur-xl pointer-events-none"
          />

          {/* Sculpted Himalayan Arch Alcove matching the pure black studio lighting of the jar photograph */}
          <div className="relative h-full w-full rounded-t-[170px] rounded-b-[18px] bg-black px-4 pt-9 pb-3 border border-[#C69B51]/55 shadow-[0_26px_45px_-16px_rgba(40,26,21,0.55)] overflow-hidden flex items-end justify-center">
            {/* Subtle overhead studio spotlight */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 inset-x-8 h-24 rounded-full bg-gradient-to-b from-[#C69B51]/20 to-transparent blur-xl"
            />
            <img
              src={customImageUrl}
              alt={alt}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="relative z-10 w-full h-full object-contain"
            />
            {/* Subtle warm gold reflection sweep along bottom glass edge */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-8 bottom-1 h-4 rounded-full bg-gradient-to-r from-transparent via-[#C69B51]/30 to-transparent blur-sm"
            />
          </div>
        </motion.div>

        {/* Sculpted Natural Travertine Stone Pedestal */}
        <div className="relative z-0 w-[86%] max-w-[390px] -mt-2 flex flex-col items-center">
          <div className="h-4 w-[92%] rounded-[50%] bg-gradient-to-r from-[#C8B7A3] via-[#E5D9CA] to-[#B7A48F] border border-[#FAF8F4]/50 shadow-inner" />
          <div className="h-9 sm:h-11 w-[88%] -mt-2 rounded-b-2xl bg-gradient-to-r from-[#8D7562] via-[#A9927D] to-[#745D4B] border-x border-b border-[#281A15]/15 shadow-[0_18px_28px_-10px_rgba(40,26,21,0.35)] flex items-center justify-center">
            <span className="text-[10px] tracking-[0.26em] uppercase text-[#FAF8F4]/80 font-medium">
              20 g Apothecary Jar
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Lab Report Reference Image / PDF Preview (never cropped or altered)
  if (kind === 'lab' && customImageUrl && !imgFailed) {
    const isPdf =
      customImageUrl.toLowerCase().endsWith('.pdf') ||
      customImageUrl.startsWith('data:application/pdf');
    if (isPdf) {
      return (
        <div
          className={`w-full h-full flex flex-col items-center justify-center gap-3 bg-[#FAF8F4] p-6 text-center ${className}`}
        >
          <FileText className="h-12 w-12 text-[#79543D]" />
          <p className="font-serif text-lg font-semibold text-[#281A15]">
            Laboratory Certificate (PDF)
          </p>
          <p className="text-xs text-[#79543D]">
            Original laboratory document uploaded by store administrator.
          </p>
        </div>
      );
    }
    return (
      <div className={`w-full h-full bg-white flex items-center justify-center p-2 ${className}`}>
        <img
          src={customImageUrl}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  // Product Gallery Poster / Brand Seal / Custom Image
  if (customImageUrl && !imgFailed) {
    const isSeal = customImageUrl.includes('9.55.23_PM');
    return (
      <div
        className={`relative w-full h-full flex items-center justify-center overflow-hidden ${
          isSeal ? 'bg-gradient-to-b from-[#FAF8F4] to-[#EDE3D4] p-4' : 'bg-black'
        } ${className}`}
      >
        <img
          src={customImageUrl}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={
            isSeal
              ? 'w-full h-full object-contain rounded-xl'
              : 'w-full h-full object-contain'
          }
        />
      </div>
    );
  }

  // Fallback & Editorial Texture / Ritual Illustrations
  if (kind === 'texture') {
    return (
      <div className={`relative w-full h-full overflow-hidden rounded-2xl bg-[#EFE7DB] ${className}`}>
        <svg viewBox="0 0 640 480" className="w-full h-full" role="img" aria-label={alt}>
          <defs>
            <radialGradient id="travBg" cx="50%" cy="45%" r="65%">
              <stop offset="0%" stopColor="#FAF8F4" />
              <stop offset="100%" stopColor="#DFD2C0" />
            </radialGradient>
            <linearGradient id="brassSpoon" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#E6C785" />
              <stop offset="50%" stopColor="#C69B51" />
              <stop offset="100%" stopColor="#8B662B" />
            </linearGradient>
            <radialGradient id="resinBlob" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#4A3429" />
              <stop offset="45%" stopColor="#1E130F" />
              <stop offset="100%" stopColor="#0E0806" />
            </radialGradient>
          </defs>
          <rect width="640" height="480" fill="url(#travBg)" />
          <ellipse cx="320" cy="395" rx="250" ry="38" fill="#79543D" fillOpacity="0.09" />
          <ellipse cx="195" cy="240" rx="108" ry="88" fill="#281A15" />
          <ellipse cx="195" cy="240" rx="92" ry="72" fill="#170E0B" />
          <ellipse cx="195" cy="242" rx="76" ry="58" fill="url(#resinBlob)" />
          <path
            d="M148 228 Q185 206 232 224"
            stroke="#FAF8F4"
            strokeOpacity="0.2"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
          />
          <ellipse cx="475" cy="145" rx="68" ry="26" fill="url(#brassSpoon)" />
          <path
            d="M407 145 L407 166 C407 180 437 192 475 192 C513 192 543 180 543 166 L543 145 Z"
            fill="#B2873E"
          />
          <path d="M275 315 L525 225 L533 236 L284 330 Z" fill="url(#brassSpoon)" />
          <ellipse
            cx="268"
            cy="322"
            rx="44"
            ry="24"
            transform="rotate(-18 268 322)"
            fill="url(#brassSpoon)"
          />
          <path
            d="M244 316 C244 296 276 286 290 302 C304 318 286 338 262 336 C248 335 244 326 244 316 Z"
            fill="url(#resinBlob)"
          />
          <ellipse
            cx="260"
            cy="306"
            rx="8"
            ry="4"
            transform="rotate(-22 260 306)"
            fill="#FAF8F4"
            fillOpacity="0.38"
          />
          <text
            x="320"
            y="436"
            textAnchor="middle"
            fill="#79543D"
            fontFamily="Plus Jakarta Sans, sans-serif"
            fontSize="12"
            letterSpacing="2.4"
          >
            SEMI-SOLID MINERAL RESIN · GLOSSY DARK TEXTURE
          </text>
        </svg>
      </div>
    );
  }

  if (kind === 'ritual') {
    return (
      <div className={`relative w-full h-full overflow-hidden rounded-2xl bg-[#F3EDE5] ${className}`}>
        <svg viewBox="0 0 640 480" className="w-full h-full" role="img" aria-label={alt}>
          <defs>
            <linearGradient id="cupBody" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#E4D9CB" />
              <stop offset="50%" stopColor="#FAF8F4" />
              <stop offset="100%" stopColor="#D3C4B2" />
            </linearGradient>
            <radialGradient id="amberTea" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#79543D" />
              <stop offset="65%" stopColor="#A97444" />
              <stop offset="100%" stopColor="#C69B51" stopOpacity="0.7" />
            </radialGradient>
          </defs>
          <rect width="640" height="480" fill="#F3EDE5" />
          <polygon points="0,0 320,0 560,480 180,480" fill="#FAF8F4" fillOpacity="0.5" />
          <ellipse cx="320" cy="378" rx="132" ry="26" fill="#281A15" fillOpacity="0.12" />
          <path
            d="M198 202 L222 356 C225 376 266 388 320 388 C374 388 415 376 418 356 L442 202 Z"
            fill="url(#cupBody)"
          />
          <path
            d="M432 232 C472 232 478 298 426 308"
            stroke="#D9CAB8"
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
          />
          <ellipse
            cx="320"
            cy="202"
            rx="122"
            ry="30"
            fill="#FAF8F4"
            stroke="#D2C3B1"
            strokeWidth="2"
          />
          <ellipse cx="320" cy="205" rx="108" ry="23" fill="url(#amberTea)" />
          <path
            d="M270 205 C295 192 332 216 364 202 C382 194 345 218 310 212"
            stroke="#281A15"
            strokeOpacity="0.55"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
          <text
            x="320"
            y="436"
            textAnchor="middle"
            fill="#79543D"
            fontFamily="Plus Jakarta Sans, sans-serif"
            fontSize="12"
            letterSpacing="2.4"
          >
            DAILY RITUAL · DISSOLVES SMOOTHLY IN LUKEWARM WATER
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden rounded-2xl bg-[#F3EDE5] border border-[#D8CBB9] p-6 flex flex-col justify-between ${className}`}
    >
      <div className="flex items-center justify-between border-b border-[#D8CBB9] pb-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#79543D]">
            Analytical Reference Sheet
          </p>
          <p className="font-serif text-lg font-semibold text-[#281A15]">
            HimRudra Quality Registry
          </p>
        </div>
        <span className="font-mono text-xs text-[#79543D]">COA</span>
      </div>
      <p className="text-xs text-[#79543D] leading-relaxed">
        Batch documentation maintained by store administration.
      </p>
    </div>
  );
};
