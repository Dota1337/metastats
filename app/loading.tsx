export default function Loading() {
  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 border-2 border-border-subtle rounded-full" />
          <div className="absolute inset-0 w-12 h-12 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="text-fg-muted text-xs uppercase tracking-widest">metastats</div>
      </div>
    </div>
  );
}
