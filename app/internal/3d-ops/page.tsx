'use client';

import dynamic from 'next/dynamic';

// 3D-Bundle isoliert vom Public-Bundle — r3f/drei/d3-force-3d landen NUR in
// dem on-demand geladenen Chunk für diese Page, nicht im Hauptbundle der
// /tft/* und /lol/* Pages. ssr:false weil r3f auf window/canvas zugreift.
const OpsGraph = dynamic(() => import('../../components/internal/OpsGraph'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1c] text-gray-500 text-sm">
      Loading 3D scene…
    </div>
  ),
});

export default function InternalOpsPage() {
  return <OpsGraph />;
}
