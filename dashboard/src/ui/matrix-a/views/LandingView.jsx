import React, { Suspense } from "react";
import { DecodingText } from "../../foundation/DecodingText.jsx";
import { MatrixButton } from "../../foundation/MatrixButton.jsx";
import { GithubStar } from "../components/GithubStar.jsx";
import { ClientLogoRow } from "../components/ClientLogoRow.jsx";

const MatrixRain = React.lazy(() =>
  import("../components/MatrixRain.jsx").then((mod) => ({
    default: mod.MatrixRain,
  })),
);
const LandingExtras = React.lazy(() =>
  import("../components/LandingExtras.jsx").then((mod) => ({
    default: mod.LandingExtras,
  })),
);

// Matrix Card Component - Enhanced cyberpunk aesthetic
function MatrixCard({ children, className = "", variant = "default", header }) {
  const baseStyles = "relative overflow-hidden";
  
  const variants = {
    default: "border border-[#00FF41]/30 bg-black/60",
    primary: "border border-[#00FF41]/50 bg-[#00FF41]/5",
    ghost: "border border-[#00FF41]/20 bg-black/40",
  };
  
  return (
    <div className={`${baseStyles} ${variants[variant]} ${className}`}>
      {/* Scanning line animation */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#00FF41]/60 to-transparent animate-scan" />
      </div>
      
      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#00FF41]" />
      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#00FF41]" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#00FF41]" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#00FF41]" />
      
      {/* Header with ASCII art style */}
      {header && (
        <div className="relative px-5 py-4 border-b border-[#00FF41]/20">
          <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-[#00FF41]/40 to-transparent" />
          <div className="flex items-center gap-3">
            <span className="text-[#00FF41]/60 font-mono text-xs">&gt;&gt;</span>
            {header}
          </div>
        </div>
      )}
      
      {/* Content */}
      <div className="relative p-5">
        {children}
      </div>
      
      {/* CRT scanline overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px] opacity-30" />
    </div>
  );
}

// Terminal-style command display
function TerminalCommand({ command, copied, onCopy, label, helper }) {
  return (
    <div className="space-y-3">
      {label && (
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#00FF41]/50 font-mono">
          {label}
        </p>
      )}
      <div className="relative group">
        {/* Terminal window chrome */}
        <div className="absolute -inset-[1px] bg-gradient-to-r from-[#00FF41]/20 via-[#00FF41]/5 to-[#00FF41]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        
        <div className="relative flex items-center gap-0 border border-[#00FF41]/30 bg-black/80">
          {/* Prompt symbol */}
          <div className="shrink-0 px-3 py-3 border-r border-[#00FF41]/20 bg-[#00FF41]/5">
            <span className="text-[#00FF41] font-mono text-sm">$</span>
          </div>
          
          {/* Command text */}
          <div className="flex-1 min-w-0 px-4 py-3 overflow-x-auto">
            <code className="font-mono text-sm text-[#00FF41] whitespace-nowrap block">
              {command}
            </code>
          </div>
          
          {/* Copy button */}
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 px-4 py-3 border-l border-[#00FF41]/20 text-[#00FF41]/70 hover:text-[#00FF41] hover:bg-[#00FF41]/10 transition-all duration-200"
            title={copied ? "Copied!" : "Copy to clipboard"}
          >
            {copied ? (
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                <path d="M6 10.5L3.5 8l-1 1L6 13l7-7-1-1-6 5.5z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="5" y="5" width="8" height="8" rx="1"/>
                <path d="M3 11V3h8" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
      
      {helper && (
        <p className="text-[10px] uppercase tracking-[0.15em] text-[#00FF41]/40 font-mono pl-1">
          {helper}
        </p>
      )}
    </div>
  );
}

export function LandingView({
  copy,
  effectsReady,
  signInUrl,
  signUpUrl,
  loginLabel,
  signupLabel,
  handle,
  onHandleChange,
  specialHandle,
  handlePlaceholder,
  rankLabel,
  installCommand,
  installCopied,
  onCopyInstallCommand,
}) {
  const extrasSkeleton = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
      <div className="h-44 border border-[#00FF41]/15 bg-[#00FF41]/5 animate-pulse" />
      <div className="h-44 border border-[#00FF41]/15 bg-[#00FF41]/5 animate-pulse" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-mono text-[#00FF41] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden selection:bg-[#00FF41] selection:text-black">
      {/* Animated grid background */}
      <div className="fixed inset-0 z-0 opacity-20">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,65,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,65,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />
      </div>
      
      {effectsReady ? (
        <Suspense fallback={null}>
          <MatrixRain />
        </Suspense>
      ) : null}
      
      {/* Header */}
      <div className="fixed top-4 sm:top-6 right-4 sm:right-6 z-[70] flex items-center gap-3">
        <GithubStar isFixed={false} size="header" />
        <MatrixButton as="a" href={signUpUrl} size="header" className="matrix-header-chip--solid">
          <span className="font-mono font-bold text-xs tracking-[0.15em] text-black uppercase">
            {copy("landing.nav.login_signup")}
          </span>
        </MatrixButton>
      </div>
      
      {/* CRT scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.15)_50%)] bg-[length:100%_3px]" />

      {/* Main content */}
      <main className="w-full max-w-4xl relative z-10 flex flex-col items-center space-y-8 sm:space-y-12 py-8 sm:py-12">
        
        {/* Hero section */}
        <div className="text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 border border-[#00FF41]/30 bg-[#00FF41]/5 text-[10px] uppercase tracking-[0.3em] text-[#00FF41]/70">
            <span className="w-1.5 h-1.5 bg-[#00FF41] rounded-full animate-pulse" />
            System Online
          </div>
          
          <h1 className="text-4xl sm:text-6xl md:text-8xl font-black text-white tracking-tighter leading-none select-none">
            <DecodingText text={copy("landing.hero.title_primary")} /> <br />
            <span className="text-[#00FF41]">
              <DecodingText text={copy("landing.hero.title_secondary")} />
            </span>
          </h1>

          <div className="flex flex-col items-center space-y-4">
            <ClientLogoRow />
            <p className="text-xs sm:text-sm text-[#00FF41]/60 uppercase tracking-[0.2em] max-w-lg text-center">
              {copy("landing.hero.subtagline")}
            </p>
          </div>
        </div>

        {/* Landing extras */}
        {effectsReady ? (
          <Suspense fallback={extrasSkeleton}>
            <LandingExtras
              handle={handle}
              onHandleChange={onHandleChange}
              specialHandle={specialHandle}
              handlePlaceholder={handlePlaceholder}
              rankLabel={rankLabel}
            />
          </Suspense>
        ) : (
          extrasSkeleton
        )}

        {/* AI Agent Install Card */}
        <MatrixCard 
          variant="primary" 
          className="w-full max-w-2xl"
          header={
            <div className="flex items-center gap-3">
              <span className="text-lg">🤖</span>
              <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-white">
                {copy("landing.ai_agent.title")}
              </h3>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-[#00FF41]/70 leading-relaxed">
              {copy("landing.ai_agent.description")}
            </p>
            
            <TerminalCommand
              command={copy("landing.ai_agent.command")}
              copied={false}
              onCopy={() => {
                navigator.clipboard.writeText(copy("landing.ai_agent.guide_url"));
                window.open(copy("landing.ai_agent.guide_url"), "_blank");
              }}
              helper={copy("landing.ai_agent.helper")}
            />
          </div>
        </MatrixCard>

        {/* Quick Install Card */}
        <MatrixCard 
          className="w-full max-w-2xl"
          header={
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 16 16" className="w-4 h-4 text-[#00FF41]" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round"/>
              </svg>
              <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-white">
                Quick Install
              </h3>
            </div>
          }
        >
          <TerminalCommand
            command={installCommand}
            copied={installCopied}
            onCopy={onCopyInstallCommand}
            label={copy("landing.install.prompt")}
            helper={copy("landing.install.helper")}
          />
        </MatrixCard>

        {/* Screenshot */}
        <MatrixCard variant="ghost" className="w-full max-w-4xl p-1">
          <div className="relative overflow-hidden border border-[#00FF41]/20 bg-black/60">
            <img
              src="/landing-dashboard.jpg"
              alt={copy("landing.screenshot.alt")}
              className="block w-full h-auto"
              loading="lazy"
              decoding="async"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#00FF41]/10 via-transparent to-transparent" />
          </div>
        </MatrixCard>

        {/* Features Card */}
        <MatrixCard className="w-full max-w-2xl">
          <div className="space-y-5">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {copy("landing.seo.title")}
            </h2>
            <p className="text-sm text-[#00FF41]/70 leading-relaxed">
              {copy("landing.seo.summary")}
            </p>
            <ul className="space-y-3">
              {[copy("landing.seo.point1"), copy("landing.seo.point2"), copy("landing.seo.point3")].map((point, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-[#00FF41]/80">
                  <span className="shrink-0 text-[#00FF41] font-mono text-xs mt-0.5">[{i + 1}]</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <div className="pt-3 border-t border-[#00FF41]/10">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#00FF41]/40">
                {copy("landing.seo.roadmap")}
              </p>
            </div>
          </div>
        </MatrixCard>

        {/* CTA */}
        <div className="w-full max-w-sm">
          <a
            href={signUpUrl}
            className="group relative block w-full text-center overflow-hidden"
          >
            {/* Button background */}
            <div className="relative bg-[#00FF41] text-black font-black uppercase tracking-[0.3em] py-4 px-6 hover:bg-white transition-colors duration-200">
              <span className="relative z-10">{copy("landing.cta.login_signup")}</span>
            </div>
            
            {/* Bottom scanline */}
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-black/20" />
          </a>
        </div>
        
        {/* Footer status line */}
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.2em] text-[#00FF41]/40">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[#00FF41]/60 rounded-full animate-pulse" />
            v{copy("version") || "0.2.21"}
          </span>
          <span>|</span>
          <span>{copy("landing.footer.system_ready")}</span>
        </div>
      </main>
      
      {/* Add scan animation keyframes */}
      <style>{`
        @keyframes scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-scan {
          animation: scan 3s linear infinite;
        }
      `}</style>
    </div>
  );
}
