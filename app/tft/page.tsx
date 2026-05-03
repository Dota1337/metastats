'use client';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import CompList from '../components/tft/CompList';

// /tft is the comp tier list — same as /tft/comps. We mirror MetaTFT's
// approach of putting comps front-and-center on the landing.
export default function TftLandingPage() {
  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="search" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <CompList />
      </div>
      <Footer />
    </main>
  );
}
