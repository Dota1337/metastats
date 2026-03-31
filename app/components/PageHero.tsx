'use client';

interface PageHeroProps {
  title: string;
  subtitle?: string;
  leftChampion: string;
  rightChampion: string;
  children?: React.ReactNode;
}

export default function PageHero({ title, subtitle, leftChampion, rightChampion, children }: PageHeroProps) {
  return (
    <div className="relative overflow-hidden bg-[#0e1525]" style={{ minHeight: '160px' }}>
      {/* Mobile: single background with both champions side by side */}
      <div className="sm:hidden absolute inset-0 flex">
        <div className="w-1/2 relative overflow-hidden">
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${leftChampion}_0.jpg`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'brightness(1.12)', objectPosition: '35% 15%' }}
          />
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to right, rgba(14,21,37,0) 0%, rgba(14,21,37,0.8) 85%, rgba(14,21,37,1) 100%)',
          }} />
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to bottom, rgba(14,21,37,0) 0%, rgba(14,21,37,0) 50%, rgba(14,21,37,1) 100%)',
          }} />
        </div>
        <div className="w-1/2 relative overflow-hidden">
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${rightChampion}_0.jpg`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'brightness(1.12)', objectPosition: '65% 15%' }}
          />
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to left, rgba(14,21,37,0) 0%, rgba(14,21,37,0.8) 85%, rgba(14,21,37,1) 100%)',
          }} />
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to bottom, rgba(14,21,37,0) 0%, rgba(14,21,37,0) 50%, rgba(14,21,37,1) 100%)',
          }} />
        </div>
      </div>

      {/* Desktop: positioned at sides */}
      <div className="hidden sm:block absolute left-0 top-0 bottom-0 w-[35%] overflow-hidden">
        <img
          src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${leftChampion}_0.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'brightness(1.12)', objectPosition: '70% 15%' }}
        />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to right, rgba(14,21,37,0) 0%, rgba(14,21,37,0.15) 60%, rgba(14,21,37,1) 100%)',
        }} />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to bottom, rgba(14,21,37,0) 0%, rgba(14,21,37,0) 60%, rgba(14,21,37,1) 100%)',
        }} />
      </div>
      <div className="hidden sm:block absolute right-0 top-0 bottom-0 w-[35%] overflow-hidden">
        <img
          src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${rightChampion}_0.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'brightness(1.12)', objectPosition: '30% 15%' }}
        />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to left, rgba(14,21,37,0) 0%, rgba(14,21,37,0.15) 60%, rgba(14,21,37,1) 100%)',
        }} />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to bottom, rgba(14,21,37,0) 0%, rgba(14,21,37,0) 60%, rgba(14,21,37,1) 100%)',
        }} />
      </div>

      {/* Center content */}
      <div className="relative max-w-6xl mx-auto px-6 pt-14 pb-10 text-center">
        <div className="w-10 h-0.5 bg-gradient-to-r from-transparent via-[#c89b3c] to-transparent mx-auto mb-4" />
        <h1 className="text-white text-3xl font-bold">{title}</h1>
        {subtitle && <p className="text-[#8a9bb0] text-sm mt-2 max-w-lg mx-auto">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
