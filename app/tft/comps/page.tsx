'use client';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import CompList from '../../components/tft/CompList';

// /tft/comps and /tft (landing) render the same comp tier list. Keeping
// both routes alive so deep-links and the Nav tab both work.
export default function TftCompsPage() {
  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <CompList />
      </div>
      <Footer />
    </main>
  );
}
