import React from 'react';

interface WhatsAppButtonProps {
  phone?: string;
}

export const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({ phone = '9549572457' }) => {
  const digits = phone.replace(/\D/g, '');
  const fullNumber =
    digits.length === 10 ? `91${digits}` : digits.length > 0 ? digits : '919549572457';
  const prefilledText = encodeURIComponent(
    'Namaste HimRudra! I have a question about HimRudra Himalayan Shilajit Resin.'
  );
  const whatsappUrl = `https://wa.me/${fullNumber}?text=${prefilledText}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with HimRudra on WhatsApp"
      data-testid="whatsapp-us-btn"
      className="himrudra-floating-action fixed bottom-18 lg:bottom-6 left-3 sm:left-5 z-40 inline-flex h-11 w-11 sm:h-auto sm:w-auto items-center justify-center sm:gap-2.5 rounded-full bg-[#B48A49] p-0 sm:pl-2.5 sm:pr-5 sm:py-2 text-[#FAF8F4] shadow-[0_10px_26px_-6px_rgba(40,26,21,0.34)] hover:bg-[#A37B3E] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#281A15] transition-all whitespace-nowrap"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] shrink-0 shadow-inner"
      >
        <svg
          viewBox="0 0 32 32"
          className="h-5 w-5 fill-white"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M16.004 3.2c-7.06 0-12.8 5.74-12.8 12.8 0 2.256.592 4.46 1.716 6.4L3.1 29.05l6.832-1.792a12.74 12.74 0 0 0 6.072 1.544h.004c7.058 0 12.796-5.74 12.796-12.8 0-3.42-1.332-6.634-3.75-9.052A12.716 12.716 0 0 0 16.004 3.2Zm0 23.436h-.004a10.61 10.61 0 0 1-5.412-1.482l-.388-.23-4.054 1.064 1.082-3.952-.254-.404a10.575 10.575 0 0 1-1.62-5.632c0-5.864 4.772-10.636 10.646-10.636 2.842 0 5.514 1.108 7.522 3.118a10.573 10.573 0 0 1 3.114 7.522c-.002 5.864-4.774 10.632-10.632 10.632Zm5.834-7.964c-.32-.16-1.89-.932-2.184-1.038-.292-.106-.506-.16-.718.16-.214.32-.826 1.038-1.012 1.252-.186.212-.372.24-.692.08-.32-.16-1.35-.498-2.572-1.586-.952-.85-1.594-1.898-1.78-2.218-.186-.32-.02-.492.14-.652.144-.144.32-.372.48-.56.16-.186.212-.32.32-.532.106-.214.054-.4-.026-.56-.08-.16-.718-1.732-.984-2.372-.26-.622-.524-.538-.718-.548-.186-.01-.4-.012-.612-.012-.214 0-.56.08-.852.4-.294.32-1.12 1.094-1.12 2.668 0 1.572 1.146 3.092 1.306 3.306.16.212 2.256 3.444 5.464 4.83.762.33 1.358.526 1.822.674.766.244 1.464.21 2.016.126.614-.092 1.89-.772 2.158-1.518.266-.746.266-1.386.186-1.518-.08-.134-.292-.214-.612-.374Z" />
        </svg>
      </span>
      <span className="hidden sm:inline font-serif text-[17px] font-semibold tracking-wide leading-none">
        WhatsApp Us
      </span>
    </a>
  );
};
