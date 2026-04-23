import React, { useState } from 'react';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';

// ─── Animated background blobs ────────────────────────────────────────────────

const FloatingBlob = ({ style }: { style: React.CSSProperties }) => (
  <div
    style={{
      position: 'absolute',
      borderRadius: '50%',
      filter: 'blur(80px)',
      opacity: 0.35,
      animation: 'float 8s ease-in-out infinite',
      ...style,
    }}
  />
);

// ─── Main Login Page ──────────────────────────────────────────────────────────

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = (credentialResponse: CredentialResponse) => {
    setError(null);
    login(credentialResponse);
  };

  const handleError = () => {
    setError('Google Sign-In was cancelled or failed. Please try again.');
  };

  return (
    <>
      {/* Keyframe animations injected inline */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-30px) scale(1.05); }
        }
        @keyframes floatDelay {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(30px) scale(0.97); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseSlow {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .login-card { animation: fadeInUp 0.6s ease forwards; }
        .logo-pulse { animation: pulseSlow 3s ease-in-out infinite; }
      `}</style>

      <div
        style={{
          minHeight: '100dvh',
          width: '100vw',
          background: 'linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #1e1260 70%, #0f0c29 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: "'Inter', 'system-ui', sans-serif",
        }}
      >
        {/* Animated background blobs */}
        <FloatingBlob
          style={{
            width: 500, height: 500,
            background: 'radial-gradient(circle, #6366f1, #818cf8)',
            top: '-100px', left: '-100px',
            animation: 'float 9s ease-in-out infinite',
          }}
        />
        <FloatingBlob
          style={{
            width: 400, height: 400,
            background: 'radial-gradient(circle, #a855f7, #c084fc)',
            bottom: '-80px', right: '-80px',
            animation: 'floatDelay 11s ease-in-out infinite',
          }}
        />
        <FloatingBlob
          style={{
            width: 300, height: 300,
            background: 'radial-gradient(circle, #06b6d4, #0891b2)',
            top: '60%', left: '20%',
            animation: 'float 7s ease-in-out infinite 2s',
          }}
        />

        {/* Subtle grid overlay */}
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 0,
            backgroundImage:
              'linear-gradient(rgba(99,102,241,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.07) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Glass Card */}
        <div
          className="login-card"
          style={{
            position: 'relative', zIndex: 10,
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.13)',
            borderRadius: '28px',
            padding: '48px 40px',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
            textAlign: 'center',
          }}
        >
          {/* Logo */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
            <div
              className="logo-pulse"
              style={{
                width: 72, height: 72,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                borderRadius: '22px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 40px rgba(99,102,241,0.6)',
                fontSize: '32px',
              }}
            >
              🌍
            </div>
          </div>

          {/* Title */}
          <h1 style={{
            color: '#ffffff',
            fontSize: '26px',
            fontWeight: 900,
            letterSpacing: '-0.5px',
            margin: '0 0 6px 0',
            lineHeight: 1.2,
          }}>
            Geo-Intel <span style={{ color: '#a78bfa' }}>Dashboard</span>
          </h1>
          <p style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: '13px',
            fontWeight: 500,
            marginBottom: '36px',
            lineHeight: 1.5,
          }}>
            AI-powered site intelligence for smart location decisions.
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '36px' }}>
            {['📍 Ward Analysis', '🧠 AI Insights', '📊 Live Scoring'].map((f) => (
              <span key={f} style={{
                background: 'rgba(99,102,241,0.2)',
                border: '1px solid rgba(99,102,241,0.35)',
                color: '#c4b5fd',
                borderRadius: '100px',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.02em',
              }}>{f}</span>
            ))}
          </div>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px',
          }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em' }}>
              SIGN IN TO CONTINUE
            </span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
          </div>

          {/* Google Login Button — centered */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={handleError}
              theme="filled_black"
              shape="pill"
              size="large"
              text="signin_with"
              logo_alignment="left"
            />
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              marginTop: '16px',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '10px',
              padding: '10px 14px',
              color: '#fca5a5',
              fontSize: '12px',
              fontWeight: 600,
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Footer note */}
          <p style={{
            marginTop: '28px',
            color: 'rgba(255,255,255,0.2)',
            fontSize: '10px',
            lineHeight: 1.6,
          }}>
            By signing in you agree to our terms of use.<br />
            Your data is never stored on our servers.
          </p>
        </div>
      </div>
    </>
  );
};

export default LoginPage;
