import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'metastats.gg — League of Legends Stats & Market Values',
    short_name: 'metastats',
    description: 'Real-time League of Legends statistics, match history, champion data and AI-powered market values.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e1525',
    theme_color: '#c89b3c',
    icons: [
      { src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
    ],
  };
}
