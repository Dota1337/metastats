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
    <div className="relative overflow-hidden bg-[#080c18]">
      {/* Left champion */}
      <div className="absolute left-0 top-0 bottom-0 w-[35%] overflow-hidden">
        <img
          src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${leftChampion}_0.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-[70%_15%]"
        />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to right, rgba(8,12,24,0) 0%, rgba(8,12,24,0.3) 70%, rgba(8,12,24,1) 100%)',
        }} />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to bottom, rgba(8,12,24,0) 0%, rgba(8,12,24,0.1) 70%, rgba(8,12,24,1) 100%)',
        }} />
      </div>

      {/* Right champion */}
      <div className="absolute right-0 top-0 bottom-0 w-[35%] overflow-hidden">
        <img
          src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${rightChampion}_0.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-[30%_15%]"
        />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to left, rgba(8,12,24,0) 0%, rgba(8,12,24,0.3) 70%, rgba(8,12,24,1) 100%)',
        }} />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to bottom, rgba(8,12,24,0) 0%, rgba(8,12,24,0.1) 70%, rgba(8,12,24,1) 100%)',
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
