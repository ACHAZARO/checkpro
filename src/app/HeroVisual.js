'use client'

export default function HeroVisual() {
  return (
    <div className="relative w-full h-full min-h-[260px] md:min-h-[340px] flex items-center justify-center select-none overflow-hidden" aria-hidden>
      <style>{`
        @keyframes pulse-ring {
          0%   { r: 28; opacity: 0.7; }
          100% { r: 72; opacity: 0; }
        }
        @keyframes pulse-ring2 {
          0%   { r: 28; opacity: 0.5; }
          100% { r: 90; opacity: 0; }
        }
        @keyframes pulse-ring3 {
          0%   { r: 28; opacity: 0.3; }
          100% { r: 110; opacity: 0; }
        }
        @keyframes pin-float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes glow-breathe {
          0%, 100% { opacity: 0.55; }
          50%       { opacity: 0.85; }
        }
        @keyframes hex-fade-in {
          from { opacity: 0; } to { opacity: 1; }
        }
        @keyframes orbit1 {
          from { transform: rotate(0deg) translateX(82px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(82px) rotate(-360deg); }
        }
        @keyframes orbit2 {
          from { transform: rotate(180deg) translateX(108px) rotate(-180deg); }
          to   { transform: rotate(540deg) translateX(108px) rotate(-540deg); }
        }
        @keyframes orbit3 {
          from { transform: rotate(60deg) translateX(130px) rotate(-60deg); }
          to   { transform: rotate(420deg) translateX(130px) rotate(-420deg); }
        }
        .ring1 { animation: pulse-ring  2.8s ease-out infinite; }
        .ring2 { animation: pulse-ring2 2.8s ease-out infinite 0.9s; }
        .ring3 { animation: pulse-ring3 2.8s ease-out infinite 1.8s; }
        .pin-group { animation: pin-float 3.6s ease-in-out infinite; transform-origin: 200px 180px; }
        .glow-core { animation: glow-breathe 2.5s ease-in-out infinite; }
        .hex-grid { animation: hex-fade-in 1.2s ease-out forwards; opacity: 0; }
        .dot1 { animation: orbit1 12s linear infinite; transform-origin: 200px 180px; }
        .dot2 { animation: orbit2 18s linear infinite; transform-origin: 200px 180px; }
        .dot3 { animation: orbit3 22s linear infinite; transform-origin: 200px 180px; }
      `}</style>

      <svg viewBox="0 0 400 360" className="w-full max-w-sm md:max-w-md" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* Hex grid pattern */}
          <pattern id="hexPat" x="0" y="0" width="34.64" height="40" patternUnits="userSpaceOnUse">
            <path d="M17.32,0 L34.64,10 L34.64,30 L17.32,40 L0,30 L0,10 Z"
              fill="none" stroke="#3dffa0" strokeWidth="0.4" strokeOpacity="0.18"/>
          </pattern>
          {/* Radial fade mask for hex grid */}
          <radialGradient id="hexMask" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="white" stopOpacity="1"/>
            <stop offset="70%"  stopColor="white" stopOpacity="0.4"/>
            <stop offset="100%" stopColor="white" stopOpacity="0"/>
          </radialGradient>
          <mask id="hexFade">
            <rect width="400" height="360" fill="url(#hexMask)"/>
          </mask>
          {/* Glow gradient */}
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#3dffa0" stopOpacity="0.35"/>
            <stop offset="60%"  stopColor="#3dffa0" stopOpacity="0.1"/>
            <stop offset="100%" stopColor="#3dffa0" stopOpacity="0"/>
          </radialGradient>
          {/* Pin gradient */}
          <linearGradient id="pinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#52ffb0"/>
            <stop offset="100%" stopColor="#00d97e"/>
          </linearGradient>
          {/* Small orbit dot glow */}
          <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#3dffa0" stopOpacity="0.9"/>
            <stop offset="100%" stopColor="#3dffa0" stopOpacity="0"/>
          </radialGradient>
        </defs>

        {/* Hex grid background */}
        <rect className="hex-grid" width="400" height="360" fill="url(#hexPat)" mask="url(#hexFade)"/>

        {/* Ambient glow under the pin */}
        <ellipse className="glow-core" cx="200" cy="185" rx="90" ry="70" fill="url(#coreGlow)"/>

        {/* Pulse rings */}
        <circle className="ring1" cx="200" cy="175" r="28" fill="none" stroke="#3dffa0" strokeWidth="1.2"/>
        <circle className="ring2" cx="200" cy="175" r="28" fill="none" stroke="#3dffa0" strokeWidth="0.8"/>
        <circle className="ring3" cx="200" cy="175" r="28" fill="none" stroke="#3dffa0" strokeWidth="0.5"/>

        {/* Orbit dots */}
        <g className="dot1">
          <circle cx="200" cy="180" r="5" fill="url(#dotGlow)"/>
          <circle cx="200" cy="180" r="2.5" fill="#3dffa0"/>
        </g>
        <g className="dot2">
          <circle cx="200" cy="180" r="4" fill="url(#dotGlow)"/>
          <circle cx="200" cy="180" r="2" fill="#3dffa0" fillOpacity="0.7"/>
        </g>
        <g className="dot3">
          <circle cx="200" cy="180" r="3.5" fill="url(#dotGlow)"/>
          <circle cx="200" cy="180" r="1.8" fill="#3dffa0" fillOpacity="0.5"/>
        </g>

        {/* GPS Pin */}
        <g className="pin-group">
          {/* Pin shadow */}
          <ellipse cx="200" cy="218" rx="12" ry="4" fill="#3dffa0" fillOpacity="0.15"/>
          {/* Pin body — flat-top hexagon shape */}
          <path d="M200,140
            C200,140 180,155 180,172
            C180,183 189.1,192 200,192
            C210.9,192 220,183 220,172
            C220,155 200,140 200,140 Z"
            fill="url(#pinGrad)"
            style={{ filter: 'drop-shadow(0 0 10px rgba(61,255,160,0.6))' }}
          />
          {/* Pin inner dot */}
          <circle cx="200" cy="172" r="6" fill="#041a0a"/>
        </g>

        {/* Data label chips */}
        <g opacity="0.7" style={{ animation: 'hex-fade-in 2s ease-out 0.5s forwards', opacity: 0 }}>
          {/* Top-left chip */}
          <rect x="48" y="82" width="88" height="26" rx="6" fill="#101318" stroke="#1f2636" strokeWidth="1"/>
          <circle cx="64" cy="95" r="4" fill="#3dffa0" fillOpacity="0.8"/>
          <rect x="74" y="90" width="50" height="4" rx="2" fill="#3dffa0" fillOpacity="0.5"/>
          <rect x="74" y="98" width="36" height="3" rx="1.5" fill="#94a3b8" fillOpacity="0.4"/>

          {/* Bottom-right chip */}
          <rect x="264" y="248" width="96" height="26" rx="6" fill="#101318" stroke="#1f2636" strokeWidth="1"/>
          <circle cx="280" cy="261" r="4" fill="#3dffa0" fillOpacity="0.8"/>
          <rect x="290" y="256" width="55" height="4" rx="2" fill="#3dffa0" fillOpacity="0.5"/>
          <rect x="290" y="264" width="40" height="3" rx="1.5" fill="#94a3b8" fillOpacity="0.4"/>

          {/* Right stat chip */}
          <rect x="290" y="140" width="76" height="40" rx="8" fill="#101318" stroke="#1f2636" strokeWidth="1"/>
          <rect x="302" y="152" width="24" height="5" rx="2" fill="#94a3b8" fillOpacity="0.4"/>
          <rect x="302" y="161" width="48" height="7" rx="3" fill="#3dffa0" fillOpacity="0.7"/>
        </g>
      </svg>
    </div>
  )
}
