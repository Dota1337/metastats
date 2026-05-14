import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'metastats.gg — League of Legends Statistiken & Marktwerte';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #0a0e1a 0%, #0e1525 50%, #1a1f35 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px',
          position: 'relative',
        }}
      >
        {/* Gold accent top bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '6px',
            background: 'linear-gradient(90deg, transparent, #c89b3c, transparent)',
          }}
        />
        {/* Gold accent bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '6px',
            background: 'linear-gradient(90deg, transparent, #c89b3c, transparent)',
          }}
        />

        {/* Logo */}
        <div
          style={{
            fontSize: 128,
            fontWeight: 700,
            color: 'white',
            letterSpacing: '-0.02em',
            display: 'flex',
          }}
        >
          meta<span style={{ color: '#c89b3c' }}>stats</span>.gg
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 32,
            color: '#a0b0c5',
            marginTop: 20,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          League of Legends · Stats · AI Market Values
        </div>

        {/* Feature chips */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 48,
            fontSize: 24,
          }}
        >
          {['Leaderboard', 'Champions', 'Pro Teams', 'Market Intelligence'].map(label => (
            <div
              key={label}
              style={{
                padding: '8px 20px',
                border: '1px solid rgba(200, 155, 60, 0.4)',
                borderRadius: 8,
                color: '#c89b3c',
                background: 'rgba(200, 155, 60, 0.08)',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
