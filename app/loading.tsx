export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0e1525] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 border-2 border-[#1e2a3a] rounded-full" />
          <div className="absolute inset-0 w-12 h-12 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="text-[#4a5a70] text-xs uppercase tracking-widest">metastats</div>
      </div>
    </div>
  );
}
